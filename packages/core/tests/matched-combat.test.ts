import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createCharacter, defaultBattlefieldEngine, grantSkill, joinBattle, matchPowerBps, newBattle, runNpcTurns, seedContent, skillChoices, startBattle, tileTypes,
  type Battle, type BattlefieldEngine, type TileType } from '../src';

function duel(ids: string[] = []) {
  const hero = createCharacter('hero', 'Герой', seedContent);
  for (const id of ['strike', ...ids]) grantSkill(hero, id, seedContent);
  const battle = newBattle('battle', 'Свободный выбор', 'duel', 'on-match', hero, seedContent);
  const enemy = createCharacter('enemy', 'Враг', seedContent); grantSkill(enemy, 'strike', seedContent);
  joinBattle(battle, enemy, 1); startBattle(battle, () => 0);
  return battle;
}
function engine(direct: Partial<Record<TileType, number>>, generated: Partial<Record<TileType, number>> = {}): BattlefieldEngine {
  const counts = (value: Partial<Record<TileType, number>>) => ({ count: Object.values(value).reduce((sum, value) => sum + (value ?? 0), 0), byType: { ...value } });
  return { ...defaultBattlefieldEngine, move: field => {
    const first = counts(direct), secondary = counts(generated);
    return { ...structuredClone(field), direct: first, generated: secondary, total: { count: first.count + secondary.count, byType: {} }, cascades: secondary.count ? 1 : 0,
      steps: [...(first.count ? [{ source: 'direct' as const, removed: first }] : []), ...(secondary.count ? [{ source: 'generated' as const, removed: secondary }] : [])], shuffled: false, regeneration: null };
  } };
}
function swap(battle: Battle, direct: Partial<Record<TileType, number>> = {}, generated: Partial<Record<TileType, number>> = {}) {
  applyAction(battle, battle.activeId!, { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: '' }, () => 0, engine(direct, generated));
}
function cast(battle: Battle, skillId = 'strike', targetId = 'enemy') { applyAction(battle, battle.activeId!, { type: 'skill', skillId, targetId }); }
function pass(battle: Battle) { swap(battle); applyAction(battle, battle.activeId!, { type: 'end' }); }

test('every ordinary or defense cell supplies two energy, with cascades credited after the basic attack', () => {
  for (const type of tileTypes) {
    const battle = duel(); swap(battle, { [type]: 3 }, { [type]: 3 });
    assert.equal(battle.fighters[0].skillEnergy, 6);
    assert.ok(battle.skillChoices!.find(choice => choice.skillId === 'strike')!.enabled);
    assert.equal(battle.fighters[0].guardDefense, type === 'defense' ? 30 : 0);
    cast(battle); assert.equal(battle.fighters[0].skillEnergy, 11);
    assert.equal(battle.fighters[0].guardDefense, type === 'defense' ? 30 : 0);
  }
});

test('all learned skills are visible after any swap, with separate bonuses and resource blockers', () => {
  const battle = duel(['ember', 'fireball', 'spring']); swap(battle, { water: 3 });
  assert.deepEqual(battle.skillChoices!.map(choice => choice.skillId), ['strike', 'ember', 'fireball', 'spring']);
  assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'ember')!.matchPowerBps, 10000);
  assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'spring')!.matchPowerBps, 15000);
  assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'spring')!.reason, 'Недостаточно энергии');
  cast(battle, 'ember'); assert.equal(battle.fighters[0].skillEnergy, 3); assert.equal(battle.fighters[1].hp, 226);
});

test('a nonmatching swap keeps positions and allows a saved-energy skill without resonance', () => {
  const battle = duel(); battle.fighters[0].skillEnergy = 1;
  battle.board = [['fire', 'water', 'earth', 'air']]; battle.battlefield = { size: { rows: 1, cols: 4 }, elementTypes: [...tileTypes] };
  applyAction(battle, 'hero', { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: '' });
  assert.deepEqual(battle.board, [['water', 'fire', 'earth', 'air']]);
  assert.equal(battle.phase, 'choose'); assert.equal(battle.activeId, 'hero');
  assert.equal(battle.skillChoices![0].matchPowerBps, 10000);
  cast(battle); assert.equal(battle.fighters[0].skillEnergy, 0); assert.equal(battle.fighters[1].hp, 230);
});

test('an empty-energy nonmatching turn can be skipped without altering HP or resources', () => {
  const battle = duel(); const hp = battle.fighters.map(f => f.hp);
  swap(battle); assert.equal(battle.skillChoices![0].enabled, false);
  applyAction(battle, 'hero', { type: 'end' });
  assert.equal(battle.activeId, 'enemy'); assert.deepEqual(battle.fighters.map(f => f.hp), hp);
});

test('resonance is per school, starts at 1.5, caps at 2.5 and ignores unrelated and generated cells', () => {
  for (const [count, expected] of [[0, 10000], [2, 10000], [3, 15000], [4, 17500], [5, 20000], [6, 22500], [7, 25000], [32, 25000]]) {
    const battle = duel(['ember']); swap(battle, { fire: count, water: 3, defense: 3 }, { fire: 20 });
    assert.equal(matchPowerBps(battle, battle.content.skills.find(skill => skill.id === 'ember')!), expected);
    assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'strike')!.matchPowerBps, 10000);
  }
  const battle = duel(['ember', 'spring']); swap(battle, { fire: 3, water: 3 });
  assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'ember')!.matchPowerBps, 15000);
  assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'spring')!.matchPowerBps, 15000);
});

test('only direct energy can fund this cast; secondary energy arrives once after spending', () => {
  const battle = duel(['fireball']); swap(battle, { air: 3 }, { fire: 40 });
  assert.equal(battle.fighters[0].skillEnergy, 6);
  const before = structuredClone(battle);
  assert.throws(() => cast(battle, 'fireball'), /энергии/); assert.deepEqual(battle, before);
  cast(battle); assert.equal(battle.fighters[0].skillEnergy, 85);
  assert.equal(battle.pendingBattlefield, undefined); assert.deepEqual(battle.directMatches, {});
  assert.throws(() => cast(battle), /не изучен|другого участника|перестановку/);
});

test('capacity is freed before cascades, and the shared pool never exceeds 200', () => {
  const battle = duel(['fireball']); battle.fighters[0].skillEnergy = 199;
  swap(battle, { air: 3 }, { water: 3 });
  assert.equal(battle.fighters[0].skillEnergy, 200);
  cast(battle, 'fireball'); assert.equal(battle.fighters[0].skillEnergy, 181);
  pass(battle); swap(battle, { earth: 3 }, { defense: 100 }); applyAction(battle, 'hero', { type: 'end' });
  assert.equal(battle.fighters[0].skillEnergy, 200);
});

test('healing can use stored energy after another school and is strengthened only by its own direct cells', () => {
  for (const [type, expected] of [['fire', 70], ['water', 75]] as const) {
    const battle = duel(['spring']); battle.fighters[0].hp = 60; battle.fighters[0].skillEnergy = 8;
    swap(battle, { [type]: 3 }, { water: 20 }); cast(battle, 'spring', 'hero');
    assert.equal(battle.fighters[0].hp, expected); assert.equal(battle.fighters[0].skillEnergy, 46);
  }
});

test('invalid targets and unknown skills cannot partially spend energy or bypass phases', () => {
  const battle = duel(['fireball']); battle.fighters[0].skillEnergy = 50;
  assert.throws(() => cast(battle), /перестановку/);
  swap(battle, { earth: 3 }); const before = structuredClone(battle);
  assert.throws(() => cast(battle, 'fireball', 'hero'), /противника/);
  assert.throws(() => cast(battle, 'missing'), /не изучен/);
  assert.throws(() => swap(battle), /одна перестановка/);
  assert.deepEqual(battle, before);
});

test('cooldown 2 still blocks the next two own turns despite free school choice', () => {
  const battle = duel(['fireball']); battle.fighters[0].skillEnergy = 100;
  swap(battle, { air: 3 }); cast(battle, 'fireball');
  for (let turn = 0; turn < 2; turn++) {
    pass(battle); swap(battle, { fire: 3 });
    assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'fireball')!.reason, 'Навык перезаряжается');
    applyAction(battle, 'hero', { type: 'end' });
  }
  pass(battle); swap(battle);
  assert.equal(battle.skillChoices!.find(choice => choice.skillId === 'fireball')!.enabled, true);
});

test('a potion consumes the one application but preserves the mandatory swap and all tile energy', () => {
  const battle = duel(); battle.fighters[0].hp = 100;
  applyAction(battle, 'hero', { type: 'item', itemId: 'potion' });
  assert.throws(() => applyAction(battle, 'hero', { type: 'end' }), /перестановку/);
  swap(battle, { defense: 3 }, { physical: 4 });
  assert.equal(battle.activeId, 'enemy'); assert.equal(battle.fighters[0].hp, 135);
  assert.equal(battle.fighters[0].skillEnergy, 14); assert.equal(battle.fighters[0].guardDefense, 30);
});

test('NPC can spend energy after an unrelated or nonmatching swap under the same rules', () => {
  for (const cells of [{ water: 3 }, {}]) {
    const battle = duel(); battle.activeId = 'enemy'; battle.fighters[1].npc = true; battle.fighters[1].skillEnergy = 1;
    runNpcTurns(battle, engine(cells));
    assert.equal(battle.activeId, 'hero'); assert.ok(battle.fighters[0].hp < 240);
  }
});

test('saved continuations restore without rerolling the board, and publish each skill bonus', () => {
  const battle = duel(['ember']), field = engine({ fire: 4 }, { defense: 3 });
  const directBoard = structuredClone(battle.board), finalBoard = structuredClone(battle.board);
  directBoard[0][0] = 'fire'; finalBoard[0][0] = 'water';
  let calls = 0;
  const staged: BattlefieldEngine = { ...field, move: (...args) => {
    calls++; const result = field.move(...args); result.board = finalBoard;
    result.steps[0].boardAfter = directBoard; result.steps[1].boardAfter = finalBoard; return result;
  } };
  applyAction(battle, 'hero', { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: '' }, () => 0, staged);
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  assert.equal(restored.skillChoices!.find(choice => choice.skillId === 'ember')!.matchPowerBps, 17500);
  applyAction(restored, 'hero', { type: 'skill', skillId: 'ember', targetId: 'enemy' }, () => { throw new Error('must not reroll'); }, staged);
  assert.equal(calls, 1); assert.deepEqual(restored.board, finalBoard); assert.equal(restored.fighters[0].skillEnergy, 11);
});
