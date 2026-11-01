import { applyAction, defaultBattlefieldEngine, type Battle, type BattlefieldEngine, type TileType } from '../../src';

/** Isolate battle lifecycle tests from random matches and cascades. */
export function fieldWithMatch(type: TileType = 'physical'): BattlefieldEngine {
  return { ...defaultBattlefieldEngine, move: field => {
    const direct = { count: 3, byType: { [type]: 3 } }, generated = { count: 0, byType: {} };
    return { ...structuredClone(field), direct, generated, total: direct, cascades: 0,
      steps: [{ source: 'direct', removed: direct }], shuffled: false, regeneration: null };
  } };
}
export function match(battle: Battle, type: TileType = 'physical') {
  applyAction(battle, battle.activeId!, { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: '' }, Math.random, fieldWithMatch(type));
}
