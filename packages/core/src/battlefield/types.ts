export const elements = ['fire', 'water', 'earth', 'air', 'physical'] as const;
export const tileTypes = [...elements, 'defense'] as const;
export type BattlefieldElement = typeof tileTypes[number];
export const DEFAULT_FIELD_SIZE = 8;
export const MAX_FIELD_SIDE = 32;
export const MAX_RESOLUTION_STEPS = 100;

export interface Cell { row: number; col: number }
export interface FieldSize { rows: number; cols: number }
export interface BattlefieldOptions<T extends string = BattlefieldElement> {
  size?: number | FieldSize;
  elementTypes?: readonly T[];
}
export interface BattlefieldConfig<T extends string = BattlefieldElement> { size: FieldSize; elementTypes: T[] }
export interface Battlefield<T extends string = BattlefieldElement> { board: T[][]; config: BattlefieldConfig<T> }
export interface RemovedElements<T extends string = BattlefieldElement> { count: number; byType: Partial<Record<T, number>> }
export interface RemovalStep<T extends string = BattlefieldElement> {
  source: 'direct' | 'generated'; removed: RemovedElements<T>;
  /** Exact server result for animation; optional for pre-existing reports. */
  cells?: Cell[]; boardAfter?: T[][];
}
export interface BattlefieldMoveReport<T extends string = BattlefieldElement> {
  direct: RemovedElements<T>;
  generated: RemovedElements<T>;
  total: RemovedElements<T>;
  /** Number of additional reductions after the first match. */
  cascades: number;
  steps: RemovalStep<T>[];
  shuffled: boolean;
  regeneration: 'no-moves' | 'cascade-limit' | null;
}
export interface BattlefieldMoveResult<T extends string = BattlefieldElement> extends Battlefield<T>, BattlefieldMoveReport<T> {}
export interface BattlefieldMove { from: Cell; to: Cell }
export interface BattlefieldMoveEvent<T extends string = BattlefieldElement> extends BattlefieldMoveReport<T>, BattlefieldMove { actorId: string }
export interface BattlefieldEngine<T extends string = BattlefieldElement> {
  create(options?: BattlefieldOptions<T>, random?: () => number): Battlefield<T>;
  move(field: Battlefield<T>, from: Cell, to: Cell, random?: () => number): BattlefieldMoveResult<T>;
  possibleMove(board: readonly (readonly T[])[]): BattlefieldMove | null;
}
