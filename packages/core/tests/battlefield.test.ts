import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battlefield, BattlefieldOptions, battlefieldOptionsSchema, createBattlefield, tileTypes, findBattlefieldMatches, findBattlefieldMove, moveBattlefield, normalizeBattlefieldOptions, resolveSwap } from '../src';

function rng(seed: number) { return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296; }; }
function sequence(values: number[], otherwise = 0.2) { let index = 0; return () => values[index++] ?? otherwise; }
function example(): Battlefield<string> {
  return {
    config: normalizeBattlefieldOptions({ size: 3, elementTypes: ['A', 'B', 'C'] }),
    board: [['B', 'C', 'B'], ['C', 'A', 'C'], ['A', 'B', 'A']],
  };
}
const from = { row: 1, col: 1 }, to = { row: 2, col: 1 };

test('square size and omitted element types use the complete default set', () => {
  const field = createBattlefield({ size: 6 }, rng(1));
  assert.deepEqual(field.config, { size: { rows: 6, cols: 6 }, elementTypes: [...tileTypes] });
  assert.equal(field.board.length, 6); assert.ok(field.board.every(row => row.length === 6));
  assert.equal(findBattlefieldMatches(field.board).length, 0); assert.ok(findBattlefieldMove(field.board));
});

test('rectangular, narrow and maximum-size boards are playable and only contain supplied types', () => {
  for (const size of [{ rows: 3, cols: 7 }, { rows: 2, cols: 3 }, { rows: 3, cols: 2 }, { rows: 1, cols: 4 }, { rows: 4, cols: 1 }, { rows: 32, cols: 32 }]) {
    for (let seed = 0; seed < 5; seed++) {
      const field = createBattlefield({ size, elementTypes: ['fire', 'water'] }, rng(seed));
      assert.equal(field.board.length, size.rows); assert.ok(field.board.every(row => row.length === size.cols));
      assert.ok(field.board.flat().every(type => ['fire', 'water'].includes(type)));
      assert.equal(findBattlefieldMatches(field.board).length, 0); assert.ok(findBattlefieldMove(field.board));
    }
  }
});

test('bounded generation has a playable fallback even for a constant RNG and many types', () => {
  const types = Array.from({ length: 32 }, (_, index) => `type-${index}`);
  for (const size of [3, { rows: 1, cols: 4 }, { rows: 4, cols: 1 }, { rows: 2, cols: 3 }]) {
    const field = createBattlefield({ size, elementTypes: types }, () => 0);
    assert.equal(findBattlefieldMatches(field.board).length, 0); assert.ok(findBattlefieldMove(field.board));
  }
});

test('direct removal and regeneration cascades return independently counted types and the exact final board', () => {
  const original = example(), before = structuredClone(original);
  // First refill is BBB; it clears. The next refill is ACA, which is stable and playable.
  const result = moveBattlefield(original, from, to, sequence([0.4, 0.4, 0.4, 0.1, 0.8, 0.1]));
  assert.deepEqual(result.direct, { count: 3, byType: { A: 3, B: 0, C: 0 } });
  assert.deepEqual(result.generated, { count: 3, byType: { A: 0, B: 3, C: 0 } });
  assert.deepEqual(result.total, { count: 6, byType: { A: 3, B: 3, C: 0 } });
  assert.deepEqual(result.board, [['A', 'C', 'A'], ['B', 'C', 'B'], ['C', 'B', 'C']]);
  assert.equal(result.cascades, 1); assert.equal(result.steps.length, 2); assert.equal(result.shuffled, false);
  assert.deepEqual(result.steps[0].cells, [{ row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }]);
  assert.deepEqual(result.steps[0].boardAfter, [['B', 'B', 'B'], ['B', 'C', 'B'], ['C', 'B', 'C']]);
  assert.deepEqual(result.steps[1].cells, [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }]);
  assert.deepEqual(result.steps[1].boardAfter, result.board);
  assert.deepEqual(original, before);
});

test('a swap without a cascade has zero generation removals', () => {
  const result = moveBattlefield(example(), from, to, sequence([0.1, 0.8, 0.1]));
  assert.equal(result.direct.count, 3); assert.deepEqual(result.generated, { count: 0, byType: { A: 0, B: 0, C: 0 } });
  assert.equal(result.total.count, 3); assert.equal(result.cascades, 0); assert.equal(result.steps.length, 1);
});

test('generation removals include existing tiles moved by gravity, not just newly spawned tiles', () => {
  const field = example(); field.board[1][0] = 'B';
  const result = moveBattlefield(field, from, to, sequence([0.4, 0.1, 0.8, 0.1, 0.8, 0.1]));
  assert.deepEqual(result.direct.byType, { A: 3, B: 0, C: 0 });
  assert.deepEqual(result.generated.byType, { A: 0, B: 3, C: 0 });
  assert.deepEqual(result.board, [['A', 'A', 'C'], ['C', 'C', 'B'], ['A', 'B', 'C']]);
});

test('two simultaneous first matches count each type independently', () => {
  const field: Battlefield<string> = { config: normalizeBattlefieldOptions({ size: { rows: 2, cols: 3 }, elementTypes: ['A', 'B', 'C'] }), board: [['A', 'B', 'A'], ['B', 'A', 'B']] };
  const result = moveBattlefield(field, { row: 0, col: 1 }, { row: 1, col: 1 }, sequence([0.4, 0.1, 0.1, 0.4, 0.4, 0.1]));
  assert.deepEqual(result.direct, { count: 6, byType: { A: 3, B: 3, C: 0 } });
  assert.equal(result.generated.count, 0); assert.equal(result.total.count, 6);
});

test('intersecting horizontal and vertical lines only count their shared tile once', () => {
  const board: string[][] = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => (row + col) % 2 ? 'E' : 'D'));
  for (const cell of [{ row: 1, col: 2 }, { row: 2, col: 1 }, { row: 2, col: 3 }, { row: 3, col: 2 }, { row: 4, col: 2 }]) board[cell.row][cell.col] = 'A';
  board[2][2] = 'B';
  const field = { board, config: normalizeBattlefieldOptions({ size: 5, elementTypes: ['A', 'B', 'D', 'E'] }) };
  const result = moveBattlefield(field, { row: 1, col: 2 }, { row: 2, col: 2 }, rng(5));
  assert.equal(result.direct.count, 5); assert.equal(result.direct.byType.A, 5);
});

test('dead-board regeneration preserves size and types without counting replaced tiles as rewards', () => {
  const field: Battlefield<string> = { config: normalizeBattlefieldOptions({ size: { rows: 1, cols: 4 }, elementTypes: ['A', 'B'] }), board: [['A', 'B', 'A', 'A']] };
  const result = moveBattlefield(field, { row: 0, col: 0 }, { row: 0, col: 1 }, sequence([0.1, 0.6, 0.1]));
  assert.equal(result.shuffled, true); assert.equal(result.direct.count, 3); assert.equal(result.generated.count, 0); assert.equal(result.total.count, 3);
  assert.deepEqual(result.config, field.config); assert.equal(result.board[0].length, 4); assert.ok(findBattlefieldMove(result.board));
});

test('size and element validation rejects impossible fields, duplicates and explicitly empty lists', () => {
  const invalid: BattlefieldOptions<string>[] = [
    { size: 0 }, { size: 2 }, { size: 33 }, { size: 3.5 }, { size: { rows: 1, cols: 3 } },
    { elementTypes: [] }, { elementTypes: ['A'] }, { elementTypes: ['A', 'A'] }, { elementTypes: ['A', ''] },
  ];
  for (const options of invalid) assert.throws(() => createBattlefield(options));
  assert.equal(battlefieldOptionsSchema.safeParse({ size: 10, elementTypes: ['fire', 'water'] }).success, true);
  assert.equal(battlefieldOptionsSchema.safeParse({ size: 10, elementTypes: ['fire', 'unknown'] }).success, false);
});

test('moves validate real dimensions and allowed types without modifying invalid inputs', () => {
  const field = example(), before = structuredClone(field);
  for (const [a, b] of [[{ row: -1, col: 0 }, to], [from, { row: 3, col: 1 }], [{ row: 0, col: 0 }, { row: 2, col: 2 }]]) assert.throws(() => moveBattlefield(field, a, b));
  const ragged = structuredClone(field); ragged.board[0].pop(); assert.throws(() => moveBattlefield(ragged, from, to), /прямоугольной/);
  const wrongSize = structuredClone(field); wrongSize.config.size.cols = 4; assert.throws(() => moveBattlefield(wrongSize, from, to), /размер/i);
  const wrongType = structuredClone(field); wrongType.board[0][0] = 'X'; assert.throws(() => moveBattlefield(wrongType, from, to), /тип/);
  const matched = structuredClone(field); matched.board[0] = ['A', 'A', 'A']; assert.throws(() => moveBattlefield(matched, from, to), /готовые совпадения/);
  assert.deepEqual(field, before);
});

test('frozen inputs can be inspected and moved, and every report reconciles by type and step', () => {
  const field = example();
  for (const row of field.board) Object.freeze(row);
  Object.freeze(field.board); Object.freeze(field.config.elementTypes); Object.freeze(field.config.size); Object.freeze(field.config); Object.freeze(field);
  assert.ok(findBattlefieldMove(field.board));
  const result = moveBattlefield(field, from, to, sequence([0.1, 0.8, 0.1]));
  for (const report of [result.direct, result.generated, result.total]) assert.equal(Object.values(report.byType).reduce<number>((sum, count) => sum + (count ?? 0), 0), report.count);
  assert.equal(result.steps.reduce((sum, step) => sum + step.removed.count, 0), result.total.count);
});

test('invalid randomness fails safely and a nonterminating refill regenerates without mutating the field', () => {
  for (const value of [-1, 1, NaN, Infinity]) assert.throws(() => createBattlefield({}, () => value), /Генератор/);
  const field = example(), before = structuredClone(field);
  const result = moveBattlefield(field, from, to, () => 0);
  assert.equal(result.regeneration, 'cascade-limit');
  assert.equal(result.steps.length, 100);
  assert.equal(result.direct.count, 3); assert.equal(result.generated.count, 297);
  assert.equal(result.total.count, 300);
  assert.equal(findBattlefieldMatches(result.board).length, 0);
  assert.ok(findBattlefieldMove(result.board));
  assert.deepEqual(field, before);
});

test('valid two-type moves always settle, including configurations with self-sustaining cascades', () => {
  let limited = 0;
  for (const size of [3, 4, 8, 16, 32]) for (let seed = 1; seed <= 20; seed++) {
    const random = rng(seed);
    const field = createBattlefield({ size, elementTypes: ['A', 'B'] }, random);
    const move = findBattlefieldMove(field.board)!;
    const result = moveBattlefield(field, move.from, move.to, random);
    assert.equal(findBattlefieldMatches(result.board).length, 0); assert.ok(findBattlefieldMove(result.board));
    assert.ok(result.board.flat().every(type => ['A', 'B'].includes(type)));
    assert.equal(result.total.count, result.direct.count + result.generated.count);
    if (result.regeneration === 'cascade-limit') limited++;
  }
  assert.ok(limited > 0);
});

test('the legacy swap adapter keeps its previous cascade-limit error and leaves the board unchanged', () => {
  const board = [['water', 'earth', 'water'], ['earth', 'fire', 'earth'], ['fire', 'water', 'fire']] as ('fire' | 'water' | 'earth')[][];
  const before = structuredClone(board);
  assert.throws(() => resolveSwap(board, from, to, () => 0), /предел каскадов/);
  assert.deepEqual(board, before);
});
