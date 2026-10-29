import { BattlefieldMoveEvent, Board, Cell, TileType } from '@game/core';

export const SWAP_MS = 300;
export const REMOVE_MS = 1000;
export const FALL_MS = 450;
export interface MovingTile { id: string; element: TileType; row: number; col: number; fromRow: number; fromCol: number; removed?: boolean }
export interface FieldMotion { tiles: MovingTile[]; stage: 'swap' | 'remove' | 'fall'; duration: number }
export interface FieldFrame { board: Board; motion: FieldMotion; duration: number }

/** Uses server-provided cells and refills; never calculates matches or generates tiles. */
export function fieldPlayback(board: Board, report: BattlefieldMoveEvent): FieldFrame[] {
  if (!report.steps.every(step => step.cells && step.boardAfter)) return [];
  let tiles: MovingTile[] = board.flatMap((row, r) => row.map((element, c) => ({ id: `old-${r}-${c}`, element, row: r, col: c, fromRow: r, fromCol: c })));
  const same = (tile: MovingTile, cell: Cell) => tile.row === cell.row && tile.col === cell.col;
  tiles = tiles.map(tile => same(tile, report.from) ? { ...tile, row: report.to.row, col: report.to.col } : same(tile, report.to) ? { ...tile, row: report.from.row, col: report.from.col } : tile);
  const swapped = board.map(row => [...row]);
  [swapped[report.from.row][report.from.col], swapped[report.to.row][report.to.col]] = [swapped[report.to.row][report.to.col], swapped[report.from.row][report.from.col]];
  const frames: FieldFrame[] = [{ board: swapped, motion: { tiles, stage: 'swap', duration: SWAP_MS }, duration: SWAP_MS }];
  report.steps.forEach((step, index) => {
    const removed = new Set(step.cells!.map(cell => `${cell.row}-${cell.col}`));
    tiles = tiles.map(tile => ({ ...tile, fromRow: tile.row, fromCol: tile.col, removed: removed.has(`${tile.row}-${tile.col}`) }));
    frames.push({ board: frames[frames.length - 1].board, motion: { tiles, stage: 'remove', duration: REMOVE_MS }, duration: REMOVE_MS });
    const fallen: MovingTile[] = [];
    for (let col = 0; col < board[0].length; col++) {
      const survivors = tiles.filter(tile => tile.col === col && !tile.removed).sort((a, b) => a.row - b.row);
      const missing = board.length - survivors.length;
      for (let row = 0; row < missing; row++) fallen.push({ id: `new-${index}-${row}-${col}`, element: step.boardAfter![row][col], row, col, fromRow: row - missing, fromCol: col });
      survivors.forEach((tile, i) => fallen.push({ ...tile, row: missing + i }));
    }
    tiles = fallen;
    frames.push({ board: step.boardAfter!, motion: { tiles, stage: 'fall', duration: FALL_MS }, duration: FALL_MS });
  });
  return frames;
}
