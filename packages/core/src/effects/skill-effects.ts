import type { Battle, Fighter, Skill } from '../types';
import type { EffectPreview, SkillEffect } from './types';
import { evaluateEffectExpression } from '../formulas/effect-expression';
import { legalSkillTargets, resolveSkillTargets } from '../targeting';
import { applyStatEffect, effectGroupKey, refreshEffectAttributes, removeDeadEffects } from './lifecycle';
import { applyResolvedDamage } from '../combat/damage';
import { addLog } from '../combat/log';

interface ResolvedEffect { definition: SkillEffect; targetId: string; magnitude?: number; durationTurns?: number }
function resolveEffects(actor: Fighter, skill: Skill, selected: Fighter[]): ResolvedEffect[] {
  const rank = actor.skillLevels?.[skill.id] ?? 1;
  return (skill.effects ?? []).flatMap(definition => (definition.recipient === 'caster' ? [actor] : selected).map(target => {
    if (definition.kind === 'dispel') return { definition, targetId: target.id };
    if (!actor.attributes || !target.attributes) throw new Error('Эффект требует новые характеристики участника');
    const magnitude = evaluateEffectExpression(definition.magnitude, actor.attributes.effective, target.attributes.effective, rank);
    const durationTurns = definition.kind === 'stat_modifier' ? typeof definition.durationTurns === 'number' ? definition.durationTurns
      : evaluateEffectExpression(definition.durationTurns, actor.attributes.effective, target.attributes.effective, rank) : undefined;
    return { definition, targetId: target.id, magnitude, durationTurns };
  }));
}

export function previewSkillEffects(battle: Battle, actor: Fighter, skill: Skill): EffectPreview[] {
  return resolveEffects(actor, skill, legalSkillTargets(battle, actor, skill)).map(({ definition, targetId, magnitude, durationTurns }) => ({
    effectId: definition.id, name: definition.name ?? skill.name, kind: definition.kind, targetId, magnitude,
    ...(definition.kind !== 'dispel' ? { unit: definition.magnitude.unit } : {}), durationTurns,
    ...(definition.kind === 'stat_modifier' ? { statId: definition.statId, operation: definition.operation, polarity: definition.polarity } : {}),
  }));
}

/** Caller uses a battle draft: an invalid composed cast cannot partially spend resources. */
export function applySkillEffects(battle: Battle, actor: Fighter, skill: Skill, targetId: string): void {
  if (battle.effectsVersion !== 1) throw new Error('Навык недоступен в этой версии боя');
  const selected = resolveSkillTargets(battle, actor, skill, targetId);
  const casterSnapshot = structuredClone(actor);
  // Resolve every formula before executing the first effect, including caster recipients.
  const resolved = resolveEffects(casterSnapshot, skill, selected);
  for (const { definition, targetId: receiverId, magnitude, durationTurns } of resolved) {
    const target = battle.fighters.find(fighter => fighter.id === receiverId)!;
    if (target.hp <= 0) continue;
    if (definition.kind === 'stat_modifier') applyStatEffect(battle, actor, target, skill, definition, magnitude!, durationTurns!);
    else if (definition.kind === 'dispel') {
      const removed = (target.activeEffects ?? []).filter(effect => effect.dispellable && effect.polarity === definition.polarityToRemove
        && (!definition.tags?.length || definition.tags.some(tag => effect.tags.includes(tag))))
        .sort((left, right) => left.appliedSequence - right.appliedSequence || left.instanceId.localeCompare(right.instanceId)).slice(0, definition.maxCount);
      const ids = new Set(removed.map(effect => effect.instanceId));
      target.activeEffects = (target.activeEffects ?? []).filter(effect => !ids.has(effect.instanceId));
      if (ids.size) refreshEffectAttributes(battle, target);
      addLog(battle, `${actor.name} → ${target.name}: снято эффектов ${removed.length}${removed.length ? ` (${removed.map(effect => effect.name).join(', ')})` : ''}`);
    } else if (definition.kind === 'damage') applyResolvedDamage(battle, casterSnapshot, target, magnitude!, definition.damageType, definition.canCrit ?? true);
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
  for (const { definition, targetId: id, magnitude, durationTurns } of resolveEffects(actor, skill, selected)) {
    const target = battle.fighters.find(fighter => fighter.id === id)!;
    if (definition.kind === 'dispel') {
      score += (target.activeEffects ?? []).filter(effect => effect.dispellable && effect.polarity === definition.polarityToRemove
        && (!definition.tags?.length || definition.tags.some(tag => effect.tags.includes(tag)))).length * 100;
    } else if (definition.kind === 'stat_modifier') {
      const existing = (target.activeEffects ?? []).filter(effect => effect.stackKey === effectGroupKey(skill, definition));
      if (magnitude === 0 && definition.operation !== 'set') continue;
      const improves = !existing.length || existing.every(effect => effect.remainingTurns <= 1)
        || definition.stacking === 'stack' && existing[0].stacks < (definition.maxStacks ?? 3)
        || Math.abs(magnitude!) > Math.abs(existing[0].magnitude);
      if (improves && durationTurns) score += 10;
    }
  }
  return score;
}
