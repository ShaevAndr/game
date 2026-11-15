import type { Battle, Element } from '../types';

/** School resonance uses only the chosen skill's direct cells, never cascades or another school. */
export function matchPowerBps(battle: Pick<Battle, 'directMatches'>, skill?: { element?: Element; matchBonus?: boolean }): number {
  if (!skill?.element || skill.matchBonus === false) return 10000;
  const count = battle.directMatches?.[skill.element] ?? 0;
  return count < 3 ? 10000 : Math.min(25000, 15000 + (count - 3) * 2500);
}
export function scaleMatchPower(battle: Battle, magnitude: number, skill?: { element?: Element; matchBonus?: boolean }): number {
  return Math.floor(magnitude * matchPowerBps(battle, skill) / 10000);
}
