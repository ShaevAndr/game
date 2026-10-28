import { newLegacyBattle as newBattle, createLegacyBoard as createBoard, legacyContent as seedContent } from './helpers/legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, contentSchema,  createCharacter, joinBattle, possibleMove, rules, runNpcTurns,  startBattle, victoryRecipients } from '../src';

function botBattle(rule: typeof rules[number] = 'before-after') {
  const character = createCharacter('hero', 'Герой', seedContent, 'pyromancer');
  const battle = newBattle('test', 'Бот', 'bot', rule, character, seedContent);
  startBattle(battle);
  return battle;
}

test('solo bot battle mirrors the hero without sharing mutable state or character identity', () => {
  const battle = botBattle(), [hero, bot] = battle.fighters;
  assert.equal(battle.totalWaves, 1); assert.equal(battle.activeId, hero.id);
  assert.equal(bot.npc, true); assert.equal(bot.characterId, undefined); assert.equal(bot.team, 1);
  assert.deepEqual(bot.stats, hero.stats); assert.deepEqual(bot.skillIds, hero.skillIds);
  bot.stats.attack++; bot.skillIds.push('fireball'); bot.energy.fire++;
  assert.equal(hero.stats.attack, 8); assert.equal(hero.skillIds.includes('fireball'), false); assert.equal(hero.energy.fire, 0);
});

test('other players cannot join a solo bot lobby', () => {
  const hero = createCharacter('hero', 'Герой', seedContent);
  const battle = newBattle('test', 'Бот', 'bot', 'before', hero, seedContent);
  assert.throws(() => joinBattle(battle, { ...hero, id: 'other' }, 0), /одного игрока/);
  assert.throws(() => joinBattle(battle, { ...hero, id: 'other' }, 1), /одного игрока/);
  assert.equal(battle.fighters.length, 1);
});

for (const rule of rules) test(`bot finishes its turn under ${rule} rules`, () => {
  const battle = botBattle(rule), [hero, bot] = battle.fighters;
  // A fixed board makes the test independent of random cascade lengths.
  let seed = 42;
  battle.board = createBoard(() => ((seed = Math.imul(1664525, seed) + 1013904223 | 0) >>> 0) / 4294967296);
  applyAction(battle, hero.id, { type: 'swap', ...possibleMove(battle.board)!, targetId: bot.id });
  if (battle.phase === 'choose') applyAction(battle, hero.id, { type: 'skill', skillId: 'strike', targetId: bot.id });
  else if (battle.phase === 'after') applyAction(battle, hero.id, { type: 'end' });
  assert.equal(battle.activeId, bot.id);
  runNpcTurns(battle);
  assert.equal(battle.activeId, hero.id); assert.equal(battle.phase, 'before');
  assert.ok(hero.hp < hero.stats.maxHp);
});

test('an injured bot can heal itself and still complete its turn', () => {
  const battle = botBattle(), [hero, bot] = battle.fighters;
  bot.skillIds.push('phoenix-warmth'); bot.energy.fire = 10; bot.hp = 30; battle.activeId = bot.id;
  runNpcTurns(battle);
  assert.equal(bot.hp, 44); assert.equal(bot.cooldowns['phoenix-warmth'], 2);
  assert.equal(battle.activeId, hero.id);
});

test('bot battle has one winner without dungeon waves and never awards the NPC', () => {
  const battle = botBattle('before'), [hero, bot] = battle.fighters;
  bot.hp = 1;
  applyAction(battle, hero.id, { type: 'skill', skillId: 'strike', targetId: bot.id });
  assert.equal(battle.status, 'finished'); assert.equal(battle.wave, 1); assert.equal(battle.winner, 0);
  assert.deepEqual(victoryRecipients(battle), [hero.id]);
  battle.winner = 1; assert.deepEqual(victoryRecipients(battle), []);
});

test('legacy balance receives the default bot reward without changing other rewards', () => {
  const legacy = structuredClone(seedContent); Reflect.deleteProperty(legacy.balance.progression.victoryExperience, 'bot');
  const parsed = contentSchema.parse(legacy);
  assert.equal(parsed.balance.progression.victoryExperience.bot, 100);
  assert.equal(parsed.balance.progression.victoryExperience.dungeon, 240);
});
