import type { Content, CombatRules } from '../types';

export const COMBAT_VERSION = 2 as const;
export const ENERGY_CAP = 30;
export const STARTING_SKILL_POINTS = 4;
export const defaultCombatRules: CombatRules = { version: COMBAT_VERSION, energyCap: ENERGY_CAP, energyPerTile: 1, defensePerTile: 10 };
export function combatRules(content: Content) { return content.balance.combat ?? defaultCombatRules; }
