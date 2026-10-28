import { Battlefield, BattlefieldElement, BattlefieldMoveResult, Cell, MAX_RESOLUTION_STEPS, RemovalStep, RemovedElements } from './types';
import { battlefieldSize, normalizeBattlefieldOptions, randomIndex } from './config';
import { findBattlefieldMatches, findBattlefieldMove, swapCells } from './matches';
import { createBattlefield } from './generation';

function emptyCounts<T extends string>(types: readonly T[]): RemovedElements<T> {
  return { count: 0, byType: Object.fromEntries(types.map(type => [type, 0])) as Record<T, number> };
}
function addCounts<T extends string>(target: RemovedElements<T>, source: RemovedElements<T>) {
  target.count += source.count;
  for (const type of Object.keys(source.byType) as T[]) target.byType[type] = (target.byType[type] ?? 0) + (source.byType[type] ?? 0);
}

export function moveBattlefield<T extends string = BattlefieldElement>(field: Battlefield<T>, from: Cell, to: Cell, random = Math.random): BattlefieldMoveResult<T> {
  const config = normalizeBattlefieldOptions(field.config);
  const size = battlefieldSize(field.board);
  if (size.rows !== config.size.rows || size.cols !== config.size.cols) throw new Error('Размер матрицы не соответствует настройкам поля');
  const allowed = new Set(config.elementTypes);
  if (field.board.some(row => row.some(type => !allowed.has(type)))) throw new Error('На поле есть тип, отсутствующий в наборе элементов');
  for (const cell of [from, to]) if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.row >= size.rows || cell.col < 0 || cell.col >= size.cols) throw new Error('Клетка вне поля');
  if (Math.abs(from.row - to.row) + Math.abs(from.col - to.col) !== 1) throw new Error('Выберите две соседние фишки');
  if (findBattlefieldMatches(field.board).length) throw new Error('Перед ходом поле не должно содержать готовые совпадения');
  const board = field.board.map(row => [...row]);
  swapCells(board, from, to);
  let cells = findBattlefieldMatches(board);
  if (!cells.length) throw new Error('Перестановка должна собрать хотя бы три фишки');
  const direct = emptyCounts(config.elementTypes), generated = emptyCounts(config.elementTypes), total = emptyCounts(config.elementTypes);
  const steps: RemovalStep<T>[] = [];
  let regeneration: BattlefieldMoveResult<T>['regeneration'] = null;
  while (cells.length) {
    if (steps.length >= MAX_RESOLUTION_STEPS) { regeneration = 'cascade-limit'; break; }
    const removed = emptyCounts(config.elementTypes);
    const removedCells = new Set(cells.map(cell => cell.row * size.cols + cell.col));
    for (const cell of cells) {
      const type = board[cell.row][cell.col];
      removed.count++; removed.byType[type] = (removed.byType[type] ?? 0) + 1;
    }
    const source = steps.length === 0 ? 'direct' : 'generated';
    addCounts(source === 'direct' ? direct : generated, removed);
    addCounts(total, removed);
    steps.push({ source, removed });
    for (let col = 0; col < size.cols; col++) {
      const remaining = board.map(row => row[col]).filter((_, row) => !removedCells.has(row * size.cols + col));
      while (remaining.length < size.rows) remaining.unshift(config.elementTypes[randomIndex(config.elementTypes.length, random)]);
      for (let row = 0; row < size.rows; row++) board[row][col] = remaining[row];
    }
    cells = findBattlefieldMatches(board);
  }
  if (!regeneration && !findBattlefieldMove(board)) regeneration = 'no-moves';
  const shuffled = regeneration !== null;
  const next = shuffled ? createBattlefield(config, random) : { board, config };
  return { ...next, direct, generated, total, cascades: steps.length - 1, steps, shuffled, regeneration };
}
