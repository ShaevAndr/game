import { Battlefield, BattlefieldConfig, BattlefieldElement, BattlefieldOptions } from './types';
import { normalizeBattlefieldOptions, randomIndex } from './config';
import { findBattlefieldMove } from './matches';

/** A deterministic fallback guarantees termination even for a constant valid RNG. */
function fallback<T extends string>(config: BattlefieldConfig<T>): T[][] {
  const { rows, cols } = config.size;
  const [first, second] = config.elementTypes;
  if (rows === 1 || cols === 1) {
    const line = Array.from({ length: Math.max(rows, cols) }, (_, index) => index < 4 ? [first, second, first, first][index] : (index % 2 === 0 ? second : first));
    return rows === 1 ? [line] : line.map(type => [type]);
  }
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => (row + col) % 2 === 0 ? first : second));
}

export function createBattlefield<T extends string = BattlefieldElement>(options: BattlefieldOptions<T> = {}, random = Math.random): Battlefield<T> {
  const config = normalizeBattlefieldOptions(options);
  const { rows, cols } = config.size;
  for (let attempt = 0; attempt < 100; attempt++) {
    const board: T[][] = Array.from({ length: rows }, () => []);
    let blocked = false;
    for (let row = 0; row < rows && !blocked; row++) for (let col = 0; col < cols; col++) {
      const candidates = config.elementTypes.filter(type => !(col > 1 && board[row][col - 1] === type && board[row][col - 2] === type) && !(row > 1 && board[row - 1][col] === type && board[row - 2][col] === type));
      if (!candidates.length) { blocked = true; break; }
      board[row][col] = candidates[randomIndex(candidates.length, random)];
    }
    if (!blocked && findBattlefieldMove(board)) return { board, config };
  }
  return { board: fallback(config), config };
}
