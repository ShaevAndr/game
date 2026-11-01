import type { Battle } from '../types';

/** Missing on already resolved snapshots, which keep their original power. */
export function matchPowerBps(battle: Battle): number { return battle.matchPowerBps ?? 10000; }
export function scaleMatchPower(battle: Battle, magnitude: number): number {
  return Math.floor(magnitude * matchPowerBps(battle) / 10000);
}
