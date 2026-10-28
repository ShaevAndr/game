import { BattlefieldConfig, BattlefieldElement, BattlefieldOptions, DEFAULT_FIELD_SIZE, tileTypes, FieldSize, MAX_FIELD_SIDE } from './types';

export function normalizeBattlefieldOptions<T extends string = BattlefieldElement>(options: BattlefieldOptions<T> = {}): BattlefieldConfig<T> {
  const size = typeof options.size === 'number' ? { rows: options.size, cols: options.size } : options.size ?? { rows: DEFAULT_FIELD_SIZE, cols: DEFAULT_FIELD_SIZE };
  for (const side of [size.rows, size.cols]) {
    if (!Number.isInteger(side) || side < 1 || side > MAX_FIELD_SIDE) throw new Error(`Сторона поля должна быть целым числом от 1 до ${MAX_FIELD_SIDE}`);
  }
  if (!(Math.max(size.rows, size.cols) >= 4 || (Math.min(size.rows, size.cols) >= 2 && Math.max(size.rows, size.cols) >= 3))) throw new Error('На поле такого размера невозможен ход «три в ряд»');
  const elementTypes = options.elementTypes === undefined ? [...tileTypes] as T[] : [...options.elementTypes];
  if (elementTypes.length < 2 || elementTypes.length > 32 || elementTypes.some(type => typeof type !== 'string' || !type.trim() || type.length > 64)) throw new Error('Нужно от 2 до 32 непустых типов элементов');
  if (new Set(elementTypes).size !== elementTypes.length) throw new Error('Типы элементов не должны повторяться');
  return { size: { ...size }, elementTypes };
}

/** Shape validation is also usable on small nonplayable matrices when inspecting matches. */
export function battlefieldSize<T extends string>(board: readonly (readonly T[])[]): FieldSize {
  if (!Array.isArray(board) || !board.length || !Array.isArray(board[0]) || !board[0].length) throw new Error('Поле не должно быть пустым');
  const size = { rows: board.length, cols: board[0].length };
  if (size.rows > MAX_FIELD_SIDE || size.cols > MAX_FIELD_SIDE) throw new Error('Превышен максимальный размер поля');
  if (board.some(row => !Array.isArray(row) || row.length !== size.cols || row.some(type => typeof type !== 'string' || !type.trim()))) throw new Error('Поле должно быть прямоугольной матрицей типов элементов');
  return size;
}

export function randomIndex(length: number, random: () => number) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Генератор случайных чисел должен возвращать значение от 0 включительно до 1 исключительно');
  return Math.floor(sample * length);
}
