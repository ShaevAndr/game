import { Board, Element, elements, emptyEnergy, Energy } from './types';
export interface Cell { row: number; col: number }
export const SIZE = 8;
const randomTile = (random: () => number): Element => elements[Math.floor(random() * elements.length)]!;
export function matches(board: Board): Cell[] {
  const found = new Map<string, Cell>();
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const run: Cell[] = [];
      for (let r = row, c = col; r < SIZE && c < SIZE && board[r][c] === board[row][col]; r += dr, c += dc) run.push({ row: r, col: c });
      if (run.length >= 3) for (const cell of run) found.set(`${cell.row},${cell.col}`, cell);
    }
  }
  return [...found.values()];
}
function swap(board: Board, a: Cell, b: Cell) { [board[a.row][a.col], board[b.row][b.col]] = [board[b.row][b.col], board[a.row][a.col]]; }
export function possibleMove(board: Board): { from: Cell; to: Cell } | null {
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const to = { row: row + dr, col: col + dc }, from = { row, col };
    if (to.row >= SIZE || to.col >= SIZE) continue;
    swap(board, from, to); const valid = matches(board).length > 0; swap(board, from, to);
    if (valid) return { from, to };
  }
  return null;
}
export function createBoard(random = Math.random): Board {
  for (let attempt = 0; attempt < 100; attempt++) {
    const board: Board = Array.from({ length: SIZE }, () => []);
    for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
      const candidates = elements.filter(tile => !(col > 1 && board[row][col - 1] === tile && board[row][col - 2] === tile) && !(row > 1 && board[row - 1][col] === tile && board[row - 2][col] === tile));
      board[row][col] = candidates[Math.floor(random() * candidates.length)]!;
    }
    if (possibleMove(board)) return board;
  }
  throw new Error('Не удалось создать игровое поле');
}
export function resolveSwap(original: Board, from: Cell, to: Cell, random = Math.random): { board: Board; energy: Energy; count: number; cascades: number; shuffled: boolean } {
  for (const c of [from, to]) if (!Number.isInteger(c.row) || !Number.isInteger(c.col) || c.row < 0 || c.row >= SIZE || c.col < 0 || c.col >= SIZE) throw new Error('Клетка вне поля');
  if (Math.abs(from.row - to.row) + Math.abs(from.col - to.col) !== 1) throw new Error('Выберите две соседние фишки');
  const board = original.map(row => [...row]); swap(board, from, to);
  let cells = matches(board);
  if (!cells.length) throw new Error('Перестановка должна собрать хотя бы три фишки');
  const energy = emptyEnergy(); let count = 0, cascades = 0;
  while (cells.length) {
    if (++cascades > 100) throw new Error('Превышен предел каскадов');
    count += cells.length;
    const removed = new Set(cells.map(c => `${c.row},${c.col}`));
    for (const c of cells) energy[board[c.row][c.col]]++;
    for (let col = 0; col < SIZE; col++) {
      const remaining = board.map(row => row[col]).filter((_, row) => !removed.has(`${row},${col}`));
      while (remaining.length < SIZE) remaining.unshift(randomTile(random));
      for (let row = 0; row < SIZE; row++) board[row][col] = remaining[row];
    }
    cells = matches(board);
  }
  const shuffled = !possibleMove(board);
  return { board: shuffled ? createBoard(random) : board, energy, count, cascades, shuffled };
}
