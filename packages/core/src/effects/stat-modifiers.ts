import type { Fighter } from '../types';
import { calculateAttributes, clampCurrentHp, compatibilityStats, type StatDefinition, type StatModifier } from '../attributes';

/** Called inside the battle aggregate when active modifier sources change. */
export function replaceFighterModifiers(fighter: Fighter, modifiers: StatModifier[], definitions: StatDefinition[]): void {
  if (!fighter.attributeState) throw new Error('Участник использует прежнюю модель характеристик');
  const state = { ...fighter.attributeState, temporaryModifiers: structuredClone(modifiers) };
  const attributes = calculateAttributes({ definitions, ...state });
  const hp = clampCurrentHp(fighter.hp, attributes.effective.maxHp);
  fighter.attributeState = state; fighter.attributes = attributes;
  fighter.stats = compatibilityStats(attributes.effective); fighter.hp = hp;
}
