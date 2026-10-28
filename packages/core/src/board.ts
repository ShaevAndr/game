/** Compatibility API. New code uses the battlefield module and its explicit configuration. */
import { Board, emptyEnergy } from './types';
import { BattlefieldOptions, Cell, createBattlefield, DEFAULT_FIELD_SIZE, findBattlefieldMatches, findBattlefieldMove, moveBattlefield, normalizeBattlefieldOptions } from './battlefield';
export type { Cell } from './battlefield';
export const SIZE = DEFAULT_FIELD_SIZE;
export const matches = findBattlefieldMatches;
export const possibleMove = findBattlefieldMove;
export function createBoard(random?: () => number): Board;
export function createBoard(options: BattlefieldOptions, random?: () => number): Board;
export function createBoard(optionsOrRandom: BattlefieldOptions | (() => number) = {}, random = Math.random): Board {
  return typeof optionsOrRandom === 'function' ? createBattlefield({}, optionsOrRandom).board : createBattlefield(optionsOrRandom, random).board;
}
export function resolveSwap(board: Board, from: Cell, to: Cell, random = Math.random, options: BattlefieldOptions = {}) {
  const config = normalizeBattlefieldOptions({ size: { rows: board.length, cols: board[0]?.length ?? 0 }, ...options });
  const result = moveBattlefield({ board, config }, from, to, random);
  if (result.regeneration === 'cascade-limit') throw new Error('Превышен предел каскадов');
  const energy = emptyEnergy();
  for (const type of Object.keys(energy) as (keyof typeof energy)[]) energy[type] = result.total.byType[type] ?? 0;
  return { ...result, energy, count: result.total.count, cascades: result.cascades + 1 };
}
