import { BattlefieldMove, Cell } from './types';
import { battlefieldSize } from './config';

export function findBattlefieldMatches<T extends string>(board: readonly (readonly T[])[]): Cell[] {
  const { rows, cols } = battlefieldSize(board);
  const found = new Map<number, Cell>();
  const add = (row: number, col: number) => found.set(row * cols + col, { row, col });
  for (let row = 0; row < rows; row++) {
    for (let start = 0; start < cols;) {
      let end = start + 1;
      while (end < cols && board[row][end] === board[row][start]) end++;
      if (end - start >= 3) for (let col = start; col < end; col++) add(row, col);
      start = end;
    }
  }
  for (let col = 0; col < cols; col++) {
    for (let start = 0; start < rows;) {
      let end = start + 1;
      while (end < rows && board[end][col] === board[start][col]) end++;
      if (end - start >= 3) for (let row = start; row < end; row++) add(row, col);
      start = end;
    }
  }
  return [...found.values()];
}

export function swapCells<T>(board: T[][], from: Cell, to: Cell) {
  [board[from.row][from.col], board[to.row][to.col]] = [board[to.row][to.col], board[from.row][from.col]];
}
function hasMatchAt<T>(board: T[][], cell: Cell): boolean {
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    let count = 1;
    for (const direction of [-1, 1]) {
      let row = cell.row + dr * direction, col = cell.col + dc * direction;
      while (row >= 0 && row < board.length && col >= 0 && col < board[0].length && board[row][col] === board[cell.row][cell.col]) {
        count++; row += dr * direction; col += dc * direction;
      }
    }
    if (count >= 3) return true;
  }
  return false;
}
export function findBattlefieldMove<T extends string>(original: readonly (readonly T[])[]): BattlefieldMove | null {
  const { rows, cols } = battlefieldSize(original);
  const board = original.map(row => [...row]);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const from = { row, col }, to = { row: row + dr, col: col + dc };
    if (to.row >= rows || to.col >= cols || board[row][col] === board[to.row][to.col]) continue;
    swapCells(board, from, to);
    const valid = hasMatchAt(board, from) || hasMatchAt(board, to);
    swapCells(board, from, to);
    if (valid) return { from, to };
  }
  return null;
}
