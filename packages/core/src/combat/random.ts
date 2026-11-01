import type { Battle } from '../types';

/** Battle-local stream: saved with the aggregate, restored on transaction rollback. */
export function battleRandomBps(battle: Battle): number {
  if (battle.attributeRngState === undefined) {
    let seed = 2166136261;
    for (const character of battle.id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    battle.attributeRngState = seed >>> 0;
  }
  battle.attributeRngState = (Math.imul(battle.attributeRngState, 1664525) + 1013904223) >>> 0;
  return battle.attributeRngState / 4294967296 * 10000;
}
