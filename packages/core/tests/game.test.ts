import { newLegacyBattle as newBattle, createLegacyBoard as createBoard, legacyContent as seedContent } from './helpers/legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, Character, Rule, applyAction, contentSchema,  emptyEnergy, joinBattle, matches, possibleMove, resolveSwap, runNpcTurns,  startBattle } from '../src';

function rng(seed: number) { return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296; }; }
const character = (id: string): Character => ({ id, name: id, level: 1, experience: 0, skillPoints: 2, learnedSkillIds: seedContent.skills.map(s => s.id), stats: { maxHp: 120, attack: 8, defense: 3, maxEnergy: 30 }, energy: emptyEnergy(), inventory: [{ itemId: 'potion', quantity: 3 }], createdAt: new Date().toISOString() });
function duel(rule: Rule = 'before-after') { const b = newBattle('battle', 'test', 'duel', rule, character('a'), seedContent); joinBattle(b, character('b'), 1); startBattle(b); b.board = createBoard(rng(17)); return b; }
const move = (b: Battle, actor = 'a', targetId = 'b') => { const m = possibleMove(b.board); assert.ok(m); applyAction(b, actor, { type: 'swap', ...m, targetId }, rng(23)); };

test('100 seeded boards have no initial matches and always have a legal move', () => {
  for (let i = 0; i < 100; i++) { const b = createBoard(rng(i)); assert.equal(matches(b).length, 0); assert.ok(possibleMove(b)); }
});
test('cascade energy equals removed tiles, original board is unchanged', () => {
  const board = createBoard(rng(42)), original = structuredClone(board), m = possibleMove(board)!;
  const result = resolveSwap(board, m.from, m.to, rng(6));
  assert.equal(Object.values(result.energy).reduce((a, b) => a + b, 0), result.count);
  assert.ok(result.count >= 3); assert.equal(matches(result.board).length, 0); assert.ok(possibleMove(result.board)); assert.deepEqual(board, original);
});
test('cross matches count each tile once', () => {
  const b = createBoard(rng(5)); for (const [r, c] of [[3, 2], [3, 3], [3, 4], [2, 3], [4, 3]]) b[r][c] = 'fire';
  const list = matches(b); assert.equal(new Set(list.map(c => `${c.row}:${c.col}`)).size, list.length); assert.ok(list.length >= 5);
});
test('invalid swaps and non-adjacent tiles are rejected without modifying input', () => {
  const b = createBoard(rng(2)), original = structuredClone(b);
  assert.throws(() => resolveSwap(b, { row: 0, col: 0 }, { row: 2, col: 0 }), /соседние/);
  assert.throws(() => resolveSwap(b, { row: -1, col: 0 }, { row: 0, col: 0 }), /вне поля/);
  assert.deepEqual(b, original);
});
test('out-of-turn actions cannot mutate a battle', () => { const b = duel(), original = structuredClone(b); assert.throws(() => move(b, 'b', 'a'), /другого/); assert.deepEqual(b, original); });
test('before mode automatically ends turn after swap and deals tile damage', () => { const b = duel('before'); move(b); assert.equal(b.activeId, 'b'); assert.ok(b.fighters[1].hp < 120); assert.ok(Object.values(b.fighters[0].energy).some(n => n > 0)); });
test('before-after mode supports a skill after the swap, once per turn', () => {
  const b = duel(); move(b); assert.equal(b.phase, 'after'); assert.equal(b.activeId, 'a');
  applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'b' }); assert.throws(() => applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'b' }), /недоступен/);
  applyAction(b, 'a', { type: 'end' }); assert.equal(b.activeId, 'b');
});
test('a second swap is prohibited', () => { const b = duel(); move(b); assert.throws(() => move(b), /одна перестановка/); });
test('before skill consumes the single skill allowance after swap', () => {
  const b = duel(); applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'b' }); move(b);
  assert.throws(() => applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'b' }), /недоступен/);
});
test('on-match mode delays damage and requires a skill to end turn', () => {
  const b = duel('on-match'); assert.throws(() => applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'b' }), /недоступен/);
  move(b); assert.equal(b.phase, 'choose'); assert.equal(b.fighters[1].hp, 120);
  assert.throws(() => applyAction(b, 'a', { type: 'end' }), /Сначала/);
  applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'b' }); assert.equal(b.activeId, 'b'); assert.ok(b.fighters[1].hp < 110);
});
test('energy costs and cooldowns are server rules', () => {
  const b = duel(); assert.throws(() => applyAction(b, 'a', { type: 'skill', skillId: 'fireball', targetId: 'b' }), /энергии/);
  b.fighters[0].energy.fire = 10; applyAction(b, 'a', { type: 'skill', skillId: 'fireball', targetId: 'b' }); assert.equal(b.fighters[0].energy.fire, 5);
  move(b); applyAction(b, 'a', { type: 'end' }); move(b, 'b', 'a'); applyAction(b, 'b', { type: 'end' });
  assert.throws(() => applyAction(b, 'a', { type: 'skill', skillId: 'fireball', targetId: 'b' }), /перезаряжается/);
});
test('energy is capped for every element', () => { const b = duel(); for (const e of Object.keys(b.fighters[0].energy)) b.fighters[0].energy[e as keyof typeof b.fighters[0]['energy']] = 30; move(b); assert.deepEqual(Object.values(b.fighters[0].energy), [30, 30, 30, 30, 30, 30]); });
test('item healing consumes inventory and the turn skill allowance', () => { const b = duel(); b.fighters[0].hp = 100; applyAction(b, 'a', { type: 'item', itemId: 'potion' }); assert.equal(b.fighters[0].hp, 120); assert.equal(b.fighters[0].inventory[0].quantity, 2); assert.equal(b.usedSkill, true); });
test('skills validate ally/enemy targeting before spending energy', () => { const b = duel(); b.fighters[0].energy.water = 10; assert.throws(() => applyAction(b, 'a', { type: 'skill', skillId: 'tide', targetId: 'b' }), /союзника/); assert.equal(b.fighters[0].energy.water, 10); });
test('duel victory finishes battle and rejects subsequent actions', () => { const b = duel('before'); b.fighters[1].hp = 1; move(b); assert.equal(b.status, 'finished'); assert.equal(b.winner, 0); assert.equal(b.activeId, null); assert.throws(() => move(b), /не активен/); });
test('team capacity and dungeon team restrictions are enforced', () => { const b = duel(); b.status = 'waiting'; assert.throws(() => joinBattle(b, character('c'), 0), /заполнена/); const d = newBattle('x', 'x', 'dungeon', 'before', character('a'), seedContent); assert.throws(() => joinBattle(d, character('b'), 1), /одной команде/); });
test('team order interleaves teams and skips defeated fighters', () => { const b = newBattle('x', 'x', 'team', 'before', character('a'), seedContent); joinBattle(b, character('c'), 0); joinBattle(b, character('b'), 1); joinBattle(b, character('d'), 1); startBattle(b); assert.deepEqual(b.fighters.map(f => f.id), ['a', 'b', 'c', 'd']); b.fighters[1].hp = 0; move(b, 'a', 'd'); assert.equal(b.activeId, 'c'); });
test('dungeon advances waves while preserving player health and energy', () => { const b = newBattle('x', 'x', 'dungeon', 'before', character('a'), seedContent); startBattle(b); b.fighters[0].hp = 80; b.fighters[1].hp = 1; move(b, 'a', 'npc-1'); assert.equal(b.wave, 2); assert.equal(b.status, 'active'); assert.equal(b.fighters[0].hp, 80); assert.ok(b.fighters.some(f => f.id === 'npc-2')); });
for (const rule of ['before', 'before-after', 'on-match'] as const) test(`NPC completes its turn under ${rule} rules`, () => {
  const b = newBattle('x', 'x', 'dungeon', rule, character('a'), seedContent); startBattle(b); b.board = createBoard(rng(16)); move(b, 'a', 'npc-1');
  if (b.phase === 'choose') applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: 'npc-1' });
  else if (b.phase === 'after') applyAction(b, 'a', { type: 'end' });
  assert.equal(b.activeId, 'npc-1'); runNpcTurns(b); assert.equal(b.activeId, 'a'); assert.ok(b.fighters[0].hp < 120);
});
test('battle content is isolated from later catalog changes', () => { const co = structuredClone(seedContent), b = newBattle('x', 'x', 'duel', 'before', character('a'), co); co.skills[0].power = 999; assert.equal(b.content.skills[0].power, 5); });
test('catalog rejects negative costs, missing wave enemies and missing fallback attacks', () => {
  assert.ok(contentSchema.safeParse(seedContent).success);
  const negative = structuredClone(seedContent); negative.skills[0].cost = -1; assert.equal(contentSchema.safeParse(negative).success, false);
  const wave = structuredClone(seedContent); wave.balance.dungeonWaves = ['missing']; assert.equal(contentSchema.safeParse(wave).success, false);
  const stuck = structuredClone(seedContent); stuck.skills[0].cost = 1; assert.equal(contentSchema.safeParse(stuck).success, false);
});
test('new instances use Mongo balance values for energy and tile damage', () => {
  const b = duel('before'); b.content.balance.energyPerTile = 2; b.content.balance.damagePerTile = 3;
  const m = possibleMove(b.board)!, result = resolveSwap(b.board, m.from, m.to, rng(23)); move(b);
  assert.equal(Object.values(b.fighters[0].energy).reduce((a, c) => a + c, 0), result.count * 2);
  assert.equal(b.fighters[1].hp, Math.max(0, 120 - result.count * 3 - 5));
});
for (const rule of ['before', 'before-after', 'on-match'] as const) test(`all dungeon waves can be completed under ${rule} rules`, () => {
  const c = character('a'); c.stats.maxHp = 100000; c.stats.attack = 1000;
  const b = newBattle('x', 'x', 'dungeon', rule, c, seedContent); startBattle(b);
  for (let i = 0; i < 20 && b.status === 'active'; i++) {
    if (b.activeId?.startsWith('npc-')) { runNpcTurns(b); continue; }
    const target = b.fighters.find(f => f.npc && f.hp > 0)!;
    if (b.phase === 'before') move(b, 'a', target.id);
    else if (b.phase === 'choose') applyAction(b, 'a', { type: 'skill', skillId: 'strike', targetId: target.id });
    else applyAction(b, 'a', { type: 'end' });
  }
  assert.equal(b.status, 'finished'); assert.equal(b.winner, 0); assert.equal(b.wave, 3);
});
test('NPC chooses a new living target after eliminating a party member with its skill', () => {
  const b = newBattle('x', 'x', 'dungeon', 'before', character('a'), seedContent);
  joinBattle(b, character('c'), 0); startBattle(b); b.fighters.find(f => f.id === 'a')!.hp = 1;
  b.activeId = 'npc-1'; runNpcTurns(b); assert.equal(b.fighters.find(f => f.id === 'a')!.hp, 0); assert.equal(b.activeId, 'c');
});
