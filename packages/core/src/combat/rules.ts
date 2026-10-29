import type { Content, CombatRules, Energy, Fighter } from '../types';

export const COMBAT_VERSION = 2 as const;
export const ENERGY_CAP = 30;
export const STARTING_SKILL_POINTS = 4;
export function totalEnergy(energy: Energy) { return Math.min(ENERGY_CAP, Object.values(energy).reduce((sum, value) => sum + value, 0)); }
/** Older v2 snapshots convert their typed reserves on first use without a DB migration. */
export function skillEnergy(fighter: Fighter) { return fighter.skillEnergy ?? totalEnergy(fighter.energy); }
export const defaultCombatRules: CombatRules = { version: COMBAT_VERSION, energyCap: ENERGY_CAP, energyPerTile: 1, defensePerTile: 10 };
export function combatRules(content: Content) { return content.balance.combat ?? defaultCombatRules; }
