import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createCharacter, joinBattle, newBattle, runNpcTurns, seedContent, startBattle, victoryRecipients } from '../src';
import { fieldWithMatch, match } from './helpers/combat';

function botBattle() {
  const character = createCharacter('hero', 'Герой', seedContent, 'pyromancer');
  const battle = newBattle('test', 'Бот', 'bot', 'on-match', character, seedContent); startBattle(battle); return battle;
}
test('bot mirrors the hero without sharing mutable state or character identity', () => {
  const battle = botBattle(), [hero, bot] = battle.fighters;
  assert.equal(battle.totalWaves, 1); assert.equal(battle.activeId, hero.id);
  assert.equal(bot.npc, true); assert.equal(bot.characterId, undefined); assert.equal(bot.team, 1);
  assert.deepEqual(bot.stats, hero.stats); assert.deepEqual(bot.skillIds, hero.skillIds);
  bot.stats.attack++; bot.skillIds.push('fireball'); bot.skillEnergy = 10;
  assert.equal(hero.stats.attack, 8); assert.equal(hero.skillIds.includes('fireball'), false); assert.equal(hero.skillEnergy, 0);
});
test('other players cannot join a solo bot lobby', () => {
  const hero = createCharacter('hero', 'Герой', seedContent);
  const battle = newBattle('test', 'Бот', 'bot', 'on-match', hero, seedContent);
  for (const team of [0, 1]) assert.throws(() => joinBattle(battle, { ...hero, id: 'other' }, team), /одного игрока/);
  assert.equal(battle.fighters.length, 1);
});
test('bot completes its board and skill phases under the same v1 rules', () => {
  const battle = botBattle(), [hero, bot] = battle.fighters;
  match(battle); applyAction(battle, hero.id, { type: 'end' });
  assert.equal(battle.activeId, bot.id);
  runNpcTurns(battle, fieldWithMatch());
  assert.equal(battle.activeId, hero.id); assert.equal(battle.phase, 'before');
  assert.ok(hero.hp < hero.stats.maxHp);
});
test('an injured bot can heal itself after directly matching the healing type', () => {
  const battle = botBattle(), [hero, bot] = battle.fighters;
  bot.skillIds.push('phoenix-warmth'); bot.skillEnergy = 10; bot.hp = 30; battle.activeId = bot.id;
  runNpcTurns(battle, fieldWithMatch('fire'));
  assert.equal(bot.hp, 44); assert.equal(bot.cooldowns['phoenix-warmth'], 2);
  assert.equal(battle.activeId, hero.id);
});
test('bot battle has one winner, no dungeon waves, and never awards the NPC', () => {
  const battle = botBattle(), [hero, bot] = battle.fighters;
  bot.hp = 1; match(battle);
  applyAction(battle, hero.id, { type: 'skill', skillId: 'strike', targetId: bot.id });
  assert.equal(battle.status, 'finished'); assert.equal(battle.wave, 1); assert.equal(battle.winner, 0);
  assert.deepEqual(victoryRecipients(battle), [hero.id]);
  battle.winner = 1; assert.deepEqual(victoryRecipients(battle), []);
});
