import type { Battle, Fighter, Skill } from '../types';
import type { EffectPreview, SkillEffect, EffectSource } from './types';
import { evaluateEffectExpression, evaluateEffectNumerator } from '../formulas/effect-expression';
import { legalSkillTargets, resolveSkillTargets } from '../targeting';
import { applyStatEffect, applyStunEffect, applyTimedEffect, effectGroupKey, refreshEffectAttributes, removeDeadEffects } from './lifecycle';
import { applyResolvedDamage } from '../combat/damage';
import { addLog } from '../combat/log';
import { activationChance, modifierBaseNumerator } from '../modifiers';
import { battleRandomBps } from '../combat/random';
import { damageChances } from '../combat/formulas';
import { rational } from '../attributes/rational';
import { matchPowerBps } from '../combat/match-power';
import { skillMagnitude, skillPower } from '../skills';

interface ResolvedEffect { rawNumerator?: bigint; chanceBps: number; definition: SkillEffect; targetId: string; magnitude?: number; durationTurns?: number }
function resolveEffects(battle: Battle, actor: Fighter, skill: EffectSource, selected: Fighter[]): ResolvedEffect[] {
  const rank = skill.rank;
  return (skill.effects ?? []).flatMap(definition => (definition.recipient === 'caster' ? [actor] : selected).map(target => {
    const shared = definition.kind === 'stat_modifier' ? battle.content.modifierDefinitions?.find(value => value.id === definition.modifierDefinitionId) : undefined;
    const modern = battle.content.modifierRulesVersion === 1;
    const chanceBps = modern ? activationChance(definition, rank, shared?.activationChanceBps) : 10000;
    if (definition.kind === 'stun') return { definition, targetId: target.id, chanceBps, durationTurns: definition.durationTurns };
    if (definition.kind === 'dispel') return { definition, targetId: target.id, chanceBps };
    let baseNumerator = 0n;
    if (modern && definition.kind === 'stat_modifier' && definition.coefficientBps !== undefined) {
      if (!shared) throw new Error('Определение допа навыка не найдено');
      baseNumerator = modifierBaseNumerator(shared, definition.operation, definition.coefficientBps + (rank - 1) * (definition.coefficientPerSkillRankBps ?? 0));
    }
    const base = evaluateEffectNumerator(definition.magnitude, actor.attributes?.effective ?? {}, target.attributes?.effective ?? {}, rank, baseNumerator);
    const multiplier = BigInt(skill.kind === 'skill' ? matchPowerBps(battle, skill) : 10000);
    // Multiply is centered on 1, so strengthening a debuff cannot turn it into a buff.
    const neutral = definition.kind === 'stat_modifier' && definition.operation === 'multiply' ? 100000000n : 0n;
    let numerator = neutral * 10000n + (base - neutral) * multiplier;
    if (neutral && numerator < 0n) numerator = 0n;
    let magnitude = Number(numerator / 100000000n - (numerator < 0n && numerator % 100000000n ? 1n : 0n));
    if (definition.kind === 'stat_modifier') magnitude = Math.max(definition.magnitude.min ?? (definition.operation === 'multiply' ? 0 : -1000000), Math.min(definition.magnitude.max ?? 1000000, magnitude));
    const durationTurns = definition.kind === 'stat_modifier' ? typeof definition.durationTurns === 'number' ? definition.durationTurns
      : evaluateEffectExpression(definition.durationTurns, actor.attributes?.effective ?? {}, target.attributes?.effective ?? {}, rank)
      : definition.kind === 'shield' || definition.kind === 'periodic_damage' || definition.kind === 'periodic_heal' ? definition.durationTurns : undefined;
    return { definition, targetId: target.id, magnitude, durationTurns, chanceBps,
      ...(battle.content.balance.formulas && definition.kind === 'damage' ? { rawNumerator: numerator } : {}) };
  }));
}

export function previewSkillEffects(battle: Battle, actor: Fighter, skill: Skill): EffectPreview[] {
  return resolveEffects(battle, actor, skillSource(actor, skill), legalSkillTargets(battle, actor, skill)).map(({ definition, targetId, magnitude, durationTurns, chanceBps }) => ({
    ...(battle.content.balance.formulas && definition.kind === 'damage' ? damageChances(battle, actor, battle.fighters.find(target => target.id === targetId)!, definition.damageType, skill.element === 'physical' ? 'physical' : 'magic') : {}),
    ...(definition.kind === 'damage' && definition.canCrit === false ? { criticalChanceBps: 0 } : {}),
    activationChanceBps: chanceBps, effectId: definition.id, name: definition.name ?? skill.name, kind: definition.kind, targetId, magnitude,
    ...(definition.kind !== 'dispel' && definition.kind !== 'stun' ? { unit: definition.magnitude.unit } : {}), durationTurns,
    ...(definition.kind === 'stat_modifier' ? { statId: definition.statId, operation: definition.operation, polarity: definition.polarity } : {}),
  }));
}

/** Caller uses a battle draft: an invalid composed cast cannot partially spend resources. */
export function applySkillEffects(battle: Battle, actor: Fighter, skill: Skill, targetId: string): void {
  if (battle.effectsVersion !== 1) throw new Error('Навык недоступен в этой версии боя');
  const selected = resolveSkillTargets(battle, actor, skill, targetId);
  applyEffects(battle, actor, skillSource(actor, skill), selected);
}
function skillSource(actor: Fighter, skill: Skill): EffectSource {
  return { ...skill, kind: 'skill', rank: actor.skillLevels?.[skill.id] ?? 1, effects: skill.effects ?? [] };
}
export function applyItemEffects(battle: Battle, actor: Fighter, item: { id: string; name: string; effects: SkillEffect[] }): void {
  applyEffects(battle, actor, { ...item, kind: 'item', rank: 1 }, [actor]);
}
function applyEffects(battle: Battle, actor: Fighter, skill: EffectSource, selected: Fighter[]): void {
  const casterSnapshot = structuredClone(actor);
  // Resolve every formula before executing the first effect, including caster recipients.
  const resolved = resolveEffects(battle, casterSnapshot, skill, selected);
  for (const { definition, targetId: receiverId, magnitude, durationTurns, chanceBps, rawNumerator } of resolved) {
    const target = battle.fighters.find(fighter => fighter.id === receiverId)!;
    const modern = battle.content.modifierRulesVersion === 1;
    const outcome = target.hp <= 0 ? 'skipped_dead_target' : chanceBps === 0 || chanceBps < 10000 && battleRandomBps(battle) >= chanceBps ? 'chance_failed' : 'applied';
    if (modern) (battle.effectResults ??= []).push({ effectId: definition.id, sourceFighterId: actor.id, ...(skill.kind === 'item' ? { sourceItemId: skill.id } : { sourceSkillId: skill.id }), targetId: target.id, chanceBps, outcome });
    if (outcome !== 'applied') {
      if (outcome === 'chance_failed') addLog(battle, `${actor.name} → ${target.name}: «${definition.name ?? skill.name}» не сработал (${chanceBps / 100}%)`);
      continue;
    }
    if (definition.kind === 'stun') applyStunEffect(battle, actor, target, skill, definition);
    else if (definition.kind === 'shield' || definition.kind === 'periodic_damage' || definition.kind === 'periodic_heal') applyTimedEffect(battle, casterSnapshot, target, skill, definition, magnitude!);
    else if (definition.kind === 'stat_modifier') applyStatEffect(battle, actor, target, skill, definition, magnitude!, durationTurns!);
    else if (definition.kind === 'dispel') {
      const removed = (target.activeEffects ?? []).filter(effect => effect.dispellable && effect.polarity === definition.polarityToRemove
        && (!definition.tags?.length || definition.tags.some(tag => effect.tags.includes(tag))))
        .sort((left, right) => left.appliedSequence - right.appliedSequence || left.instanceId.localeCompare(right.instanceId)).slice(0, definition.maxCount);
      const ids = new Set(removed.map(effect => effect.instanceId));
      target.activeEffects = (target.activeEffects ?? []).filter(effect => !ids.has(effect.instanceId));
      if (ids.size) refreshEffectAttributes(battle, target);
      addLog(battle, `${actor.name} → ${target.name}: снято эффектов ${removed.length}${removed.length ? ` (${removed.map(effect => effect.name).join(', ')})` : ''}`);
    } else if (definition.kind === 'damage') applyResolvedDamage(battle, casterSnapshot, target, magnitude!, definition.damageType, definition.canCrit ?? true, rawNumerator !== undefined ? rational(rawNumerator, 100000000) : undefined, { skillId: skill.kind === 'skill' ? skill.id : undefined, effectId: definition.id, accuracyType: skill.element === 'physical' ? 'physical' : 'magic' });
    else {
      const healed = Math.max(0, Math.min(magnitude!, target.stats.maxHp - target.hp));
      target.hp += healed; addLog(battle, `${target.name}: +${healed} HP`);
    }
  }
  removeDeadEffects(battle);
}

/** Generic NPC utility: avoid refreshing a sufficiently strong, long-lasting effect every turn. */
export function effectSkillUtility(battle: Battle, actor: Fighter, skill: Skill, targetId: string): number {
  let score = 0;
  const selected = resolveSkillTargets(battle, actor, skill, targetId);
  const rank = actor.skillLevels?.[skill.id] ?? 1;
  const simpleMagnitude = () => actor.attributes ? skillMagnitude(skill, rank, actor.attributes.effective, battle.content.balance.attributes?.skillReferencePower, matchPowerBps(battle, skill))
    : skill.effect === 'damage' ? skillPower(skill, rank) * matchPowerBps(battle, skill) / 10000 + actor.stats.attack : skillPower(skill, rank) * matchPowerBps(battle, skill) / 10000;
  const resolved: ResolvedEffect[] = skill.effects?.length ? resolveEffects(battle, actor, skillSource(actor, skill), selected)
    : selected.map(target => ({ definition: { id: skill.id, kind: skill.effect === 'heal' ? 'heal' : 'damage', recipient: 'selected',
      magnitude: { unit: 'hp', constant: 0 }, damageType: skill.element } as SkillEffect, targetId: target.id, magnitude: simpleMagnitude(), chanceBps: 10000 }));
  for (const { definition, targetId: id, magnitude, durationTurns, chanceBps } of resolved) {
    const target = battle.fighters.find(fighter => fighter.id === id)!;
    if (!chanceBps) continue;
    if (definition.kind === 'damage') {
      const defense = (target.attributes?.effective[definition.damageType === 'physical' ? 'physicalResistance' : `${definition.damageType}Resistance`] ?? target.stats.defense) + (target.guardDefense ?? 0);
      const rules = battle.content.balance.formulas, k = rules ? rules.armorK + rules.armorKPerLevel * ((actor.combatLevel ?? 1) - 1) : 0;
      const amount = rules ? Math.max(1, magnitude! * Math.max(1 - rules.armorReductionCapBps / 10000, k / (k + defense))) : Math.max(1, magnitude! - defense);
      const chances = damageChances(battle, actor, target, definition.damageType, skill.element === 'physical' ? 'physical' : 'magic');
      score += (Math.min(target.hp, amount) + (amount >= target.hp ? 20 : 0)) * chances.hitChanceBps / 10000 * (1 - chances.luckAvoidChanceBps / 10000) * chanceBps / 10000;
    } else if (definition.kind === 'heal') score += Math.min(magnitude!, target.stats.maxHp - target.hp) * chanceBps / 10000;
    else if (definition.kind === 'shield' || definition.kind === 'periodic_damage' || definition.kind === 'periodic_heal') {
      const existing = (target.activeEffects ?? []).filter(effect => effect.stackKey === effectGroupKey(skill, definition));
      const previous = existing.reduce((sum, effect) => sum + (effect.kind === 'shield' ? effect.remainingShield ?? 0 : (effect.magnitude ?? 0) * effect.remainingTurns), 0);
      const total = magnitude! * (definition.kind === 'shield' ? 1 : durationTurns!);
      const useful = definition.kind === 'periodic_heal' ? Math.min(total, target.stats.maxHp - target.hp) : total;
      score += Math.max(0, useful - (definition.stacking === 'independent' ? 0 : previous)) * 0.8 * chanceBps / 10000;
    } else if (definition.kind === 'stun') {
      if (!target.activeEffects?.some(effect => effect.kind === 'stun')) score += 18 * chanceBps / 10000;
    } else if (definition.kind === 'dispel') {
      score += (target.activeEffects ?? []).filter(effect => effect.dispellable && effect.polarity === definition.polarityToRemove
        && (!definition.tags?.length || definition.tags.some(tag => effect.tags.includes(tag))))
        .sort((a, b) => a.appliedSequence - b.appliedSequence || a.instanceId.localeCompare(b.instanceId)).slice(0, definition.maxCount)
        .reduce((sum, effect) => sum + (effect.kind === 'shield' ? effect.remainingShield ?? 0 : effect.kind === 'stun' ? 18 : effect.kind === 'stat_modifier' ? 10 : effect.magnitude * effect.remainingTurns), 0) * chanceBps / 10000;
    } else if (definition.kind === 'stat_modifier') {
      const existing = (target.activeEffects ?? []).filter(effect => effect.stackKey === effectGroupKey(skill, definition));
      if (magnitude === 0 && definition.operation !== 'set') continue;
      const improves = !existing.length || existing.every(effect => effect.remainingTurns <= 1)
        || definition.stacking === 'stack' && existing[0].stacks < (definition.maxStacks ?? 3)
        || Math.abs(magnitude!) > Math.abs(existing[0].magnitude ?? 0);
      if (improves && durationTurns) score += 10 * chanceBps / 10000;
    }
  }
  return score;
}
