import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, contentSchema, createBattleSchema, createCharacter, joinBattle, newBattle, runNpcTurns, seedContent, startBattle } from '../src';
import { fieldWithMatch, match } from './helpers/combat';

const hero = (id: string) => createCharacter(id, id, seedContent);
function duel() {
  const battle = newBattle('battle', 'Бой', 'duel', 'on-match', hero('a'), seedContent);
  joinBattle(battle, hero('b'), 1); startBattle(battle); return battle;
}
test('v1 supports only matched-type rules and rejects retired modes', () => {
  const input = { name: 'Комната', characterId: '00000000-0000-4000-8000-000000000001', kind: 'duel' };
  assert.equal(createBattleSchema.parse(input).rule, 'on-match');
  for (const rule of ['before', 'before-after']) assert.equal(createBattleSchema.safeParse({ ...input, rule }).success, false);
  assert.equal(duel().combatVersion, 1);
});
test('out-of-turn actions cannot mutate the battle', () => {
  const battle = duel(), before = structuredClone(battle);
  assert.throws(() => applyAction(battle, 'b', { type: 'end' }), /другого/);
  assert.deepEqual(battle, before);
});
test('team capacity and dungeon team restrictions are enforced', () => {
  const battle = duel(); battle.status = 'waiting';
  assert.throws(() => joinBattle(battle, hero('c'), 0), /заполнена/);
  const dungeon = newBattle('dungeon', 'Подземелье', 'dungeon', 'on-match', hero('a'), seedContent);
  assert.throws(() => joinBattle(dungeon, hero('b'), 1), /одной команде/);
});
test('team order interleaves teams and skips defeated fighters', () => {
  const battle = newBattle('team', 'Команды', 'team', 'on-match', hero('a'), seedContent);
  joinBattle(battle, hero('c'), 0); joinBattle(battle, hero('b'), 1); joinBattle(battle, hero('d'), 1); startBattle(battle);
  assert.deepEqual(battle.fighters.map(fighter => fighter.id), ['a', 'b', 'c', 'd']);
  battle.fighters[1].hp = 0; match(battle); applyAction(battle, 'a', { type: 'end' });
  assert.equal(battle.activeId, 'c');
});
test('dungeon advances all waves, preserves health and rejects commands after victory', () => {
  const character = hero('a'); character.stats.attack = 1000; character.stats.maxHp = 100000;
  const battle = newBattle('dungeon', 'Подземелье', 'dungeon', 'on-match', character, seedContent); startBattle(battle);
  battle.fighters[0].hp = 80000;
  for (let i = 0; i < 20 && battle.status === 'active'; i++) {
    if (battle.activeId !== 'a') { runNpcTurns(battle, fieldWithMatch()); continue; }
    const target = battle.fighters.find(fighter => fighter.npc && fighter.hp > 0)!;
    match(battle); applyAction(battle, 'a', { type: 'skill', skillId: 'strike', targetId: target.id });
  }
  assert.equal(battle.wave, 3); assert.equal(battle.status, 'finished'); assert.equal(battle.winner, 0);
  assert.ok(battle.fighters[0].hp <= 80000); assert.equal(battle.activeId, null);
  assert.throws(() => match(battle), /не активен/);
});
test('battle content is isolated from subsequent catalog changes', () => {
  const content = structuredClone(seedContent), battle = newBattle('snapshot', 'Снимок', 'duel', 'on-match', hero('a'), content);
  content.skills[0].power = 999; assert.equal(battle.content.skills[0].power, 5);
});
test('catalog rejects negative costs, missing wave enemies and an unaffordable starter', () => {
  assert.ok(contentSchema.safeParse(seedContent).success);
  const negative = structuredClone(seedContent); negative.skills[0].cost = -1; assert.equal(contentSchema.safeParse(negative).success, false);
  const wave = structuredClone(seedContent); wave.balance.dungeonWaves = ['missing']; assert.equal(contentSchema.safeParse(wave).success, false);
  const stuck = structuredClone(seedContent); stuck.skills[0].cost = 4; assert.equal(contentSchema.safeParse(stuck).success, false);
});
