import type { Battle, Fighter, Skill } from '../types';
import type { ActiveEffect, StatModifierEffect } from './types';
import { calculateAttributes, compatibilityStats, fillBaseAttributes, type StatModifier } from '../attributes';
import { replaceFighterModifiers } from './stat-modifiers';
import { addLog } from '../combat/log';

/** Old NPC catalogs receive a battle-local adapter, keeping their authored HP/power/defense. */
export function initializeEffectFighter(battle: Battle, fighter: Fighter): void {
  if (battle.effectsVersion !== 1) return;
  const definitions = battle.content.statDefinitions;
  if (!definitions) throw new Error('Эффекты требуют реестр характеристик');
  if (!fighter.attributeState) {
    const baseAttributes = fillBaseAttributes({}, 1, definitions);
    const intrinsic = calculateAttributes({ definitions, baseAttributes }).base;
    const wanted: Record<string, number> = { maxHp: fighter.stats.maxHp, physicalPower: fighter.stats.attack, magicPower: fighter.stats.attack,
      healingPower: fighter.stats.attack, physicalResistance: fighter.stats.defense, fireResistance: fighter.stats.defense,
      waterResistance: fighter.stats.defense, earthResistance: fighter.stats.defense, airResistance: fighter.stats.defense, criticalChanceBps: 0, criticalBonusBps: 0 };
    const permanentModifiers: StatModifier[] = Object.entries(wanted).map(([statId, value]) => ({ id: `${fighter.id}:template:${statId}`, sourceId: 'npc-template', statId, operation: 'add_flat', value: value - intrinsic[statId] }));
    fighter.attributeState = { baseAttributes, permanentModifiers, equipmentModifiers: [], equipmentScaling: [], temporaryModifiers: [] };
    fighter.attributes = calculateAttributes({ definitions, ...fighter.attributeState });
    fighter.stats = compatibilityStats(fighter.attributes.effective);
  }
  fighter.activeEffects ??= []; fighter.turnsStarted ??= 0;
}

export function refreshEffectAttributes(battle: Battle, fighter: Fighter): void {
  const definitions = battle.content.statDefinitions;
  if (!definitions) throw new Error('Эффекты требуют реестр характеристик');
  initializeEffectFighter(battle, fighter);
  const modifiers = (fighter.activeEffects ?? []).map(effect => ({ id: effect.instanceId, sourceId: effect.instanceId,
    statId: effect.statId, operation: effect.operation, value: effect.magnitude * effect.stacks,
    priority: effect.priority, appliedSequence: effect.appliedSequence }));
  replaceFighterModifiers(fighter, modifiers, definitions);
}

export function effectGroupKey(skill: Skill, effect: StatModifierEffect): string { return effect.stackKey ?? `${skill.id}:${effect.id}`; }

export function applyStatEffect(battle: Battle, actor: Fighter, target: Fighter, skill: Skill, effect: StatModifierEffect, magnitude: number, duration: number): void {
  initializeEffectFighter(battle, target);
  if (effect.operation === 'multiply' && magnitude < 0) throw new Error('Множитель не может быть отрицательным');
  const stackKey = effectGroupKey(skill, effect), stacking = effect.stacking ?? 'refresh';
  const existing = target.activeEffects!.filter(value => value.stackKey === stackKey).sort((a, b) => a.appliedSequence - b.appliedSequence || a.instanceId.localeCompare(b.instanceId));
  if (existing.some(value => value.statId !== effect.statId || value.operation !== effect.operation || value.unit !== effect.magnitude.unit || value.polarity !== effect.polarity || value.stacking !== stacking)) throw new Error('Несовместимые эффекты одной группы');
  if (stacking === 'replace_if_stronger' && existing.length && Math.abs(existing[0].magnitude) > Math.abs(magnitude)) {
    addLog(battle, `${target.name}: «${effect.name ?? skill.name}» слабее действующего эффекта`); return;
  }
  const sequence = (battle.effectSequence ?? 0) + 1;
  const maxStacks = effect.maxStacks ?? (stacking === 'stack' || stacking === 'independent' ? 3 : 1);
  const active: ActiveEffect = { instanceId: `${battle.id}:effect:${sequence}`, definitionId: `${skill.id}:${effect.id}`, name: effect.name ?? skill.name,
    sourceFighterId: actor.id, sourceName: actor.name, sourceSkillId: skill.id, sourceRank: actor.skillLevels?.[skill.id] ?? 1, targetFighterId: target.id,
    polarity: effect.polarity, tags: [...(effect.tags ?? [])], dispellable: effect.dispellable ?? true, statId: effect.statId,
    operation: effect.operation, magnitude, unit: effect.magnitude.unit, priority: effect.priority ?? 0,
    remainingTurns: duration, eligibleFromTurn: (target.turnsStarted ?? 0) + 1, appliedSequence: sequence,
    stackKey, stacking, stacks: stacking === 'stack' ? Math.min(maxStacks, (existing[0]?.stacks ?? 0) + 1) : 1, maxStacks };
  let next = [...target.activeEffects!];
  if (stacking === 'independent') {
    if (existing.length >= maxStacks) next = next.filter(value => value.instanceId !== existing[0].instanceId);
  } else next = next.filter(value => value.stackKey !== stackKey);
  next.push(active);
  if (next.length > 64) throw new Error('Достигнут лимит активных эффектов');
  target.activeEffects = next; battle.effectSequence = sequence;
  refreshEffectAttributes(battle, target);
  addLog(battle, `${actor.name} → ${target.name}: «${active.name}», ${duration} ход., стэков: ${active.stacks}`);
}

export function endEffectTurn(battle: Battle, fighter: Fighter): void {
  if (battle.effectsVersion !== 1) return;
  let changed = false;
  fighter.activeEffects = (fighter.activeEffects ?? []).filter(effect => {
    if ((fighter.turnsStarted ?? 0) < effect.eligibleFromTurn) return true;
    effect.remainingTurns--;
    if (effect.remainingTurns > 0) return true;
    changed = true; addLog(battle, `${fighter.name}: «${effect.name}» закончился`); return false;
  });
  if (changed) refreshEffectAttributes(battle, fighter);
}
export function removeDeadEffects(battle: Battle): void {
  if (battle.effectsVersion !== 1) return;
  for (const fighter of battle.fighters) if (fighter.hp <= 0 && fighter.activeEffects?.length) {
    fighter.activeEffects = []; refreshEffectAttributes(battle, fighter);
  }
}
