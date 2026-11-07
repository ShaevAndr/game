import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, battleBelt, createCharacter, expireMatchedTurn, joinBattle, newBattle, seedContent, startBattle, victoryRecipients, type Battle } from '../src';

function duel(firstTeam = 0): Battle {
  const hero = createCharacter('hero', 'Герой', seedContent);
  const battle = newBattle('battle', 'Бой', 'duel', 'on-match', hero, seedContent);
  joinBattle(battle, createCharacter('enemy', 'Противник', seedContent), 1);
  startBattle(battle, () => firstTeam ? 0.9 : 0.1);
  return battle;
}

test('lottery can give either team the first turn and keeps unequal rosters interleaved', () => {
  assert.equal(duel(0).activeId, 'hero');
  assert.equal(duel(1).activeId, 'enemy');
  const battle = newBattle('team', 'Команды', 'team', 'on-match', createCharacter('hero', 'Герой', seedContent), seedContent);
  joinBattle(battle, createCharacter('ally', 'Союзник', seedContent), 0);
  joinBattle(battle, createCharacter('enemy', 'Противник', seedContent), 1);
  startBattle(battle, () => 0.9);
  assert.deepEqual(battle.fighters.map(fighter => fighter.id), ['enemy', 'hero', 'ally']);
});

test('expiry before a swap advances cooldowns and effects without moving tiles or giving resources', () => {
  const battle = duel(), before = structuredClone(battle.board);
  battle.fighters[1].cooldowns.strike = 2;
  expireMatchedTurn(battle);
  assert.deepEqual(battle.board, before);
  assert.equal(battle.activeId, 'enemy'); assert.equal(battle.turn, 2);
  assert.equal(battle.fighters[1].cooldowns.strike, 1);
  assert.ok(battle.fighters.every(fighter => fighter.skillEnergy === 0));
});

test('expiry during choice settles the saved cascades after restoring the battle', () => {
  const battle = duel();
  battle.phase = 'choose'; battle.matchedElements = ['physical'];
  const finalBoard = battle.board.map(row => [...row].reverse());
  battle.pendingBattlefield = { board: finalBoard, config: battle.battlefield!, report: {
    actorId: 'hero', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, continuation: true,
    direct: { count: 0, byType: {} }, generated: { count: 4, byType: { water: 4 } }, total: { count: 4, byType: { water: 4 } },
    cascades: 1, steps: [], shuffled: false, regeneration: null,
  } };
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  expireMatchedTurn(restored);
  assert.deepEqual(restored.board, finalBoard); assert.equal(restored.fighters[0].skillEnergy, 4);
  assert.equal(restored.activeId, 'enemy'); assert.equal(restored.pendingBattlefield, undefined);
  assert.equal(restored.fighters[1].hp, restored.fighters[1].stats.maxHp);
});

test('surrender outside own turn finishes a duel; duplicate surrender cannot change the result', () => {
  const battle = duel();
  applyAction(battle, 'enemy', { type: 'surrender' });
  assert.equal(battle.status, 'finished'); assert.equal(battle.winner, 0);
  assert.deepEqual(victoryRecipients(battle), ['hero']);
  const before = structuredClone(battle);
  assert.throws(() => applyAction(battle, 'enemy', { type: 'surrender' }), /не активен/);
  assert.deepEqual(battle, before);
});

test('surrender removes one teammate while the others keep playing and excludes surrender rewards', () => {
  const battle = newBattle('team', 'Команды', 'team', 'on-match', createCharacter('hero', 'Герой', seedContent), seedContent);
  joinBattle(battle, createCharacter('ally', 'Союзник', seedContent), 0);
  joinBattle(battle, createCharacter('enemy', 'Противник', seedContent), 1);
  startBattle(battle, () => 0);
  applyAction(battle, 'hero', { type: 'surrender' });
  assert.equal(battle.status, 'active'); assert.equal(battle.activeId, 'enemy');
  applyAction(battle, 'enemy', { type: 'surrender' });
  assert.equal(battle.winner, 0); assert.deepEqual(victoryRecipients(battle), ['ally']);
});

test('belt has a combined capacity of ten actual consumables and never copies equipment', () => {
  const stacks = [{ itemId: 'iron-sword', quantity: 1 }, { itemId: 'potion', quantity: 7 }, { itemId: 'cleansing-potion', quantity: 8 }];
  const belt = battleBelt(stacks, seedContent);
  assert.deepEqual(belt.map(stack => [stack.itemId, stack.quantity]), [['potion', 7], ['cleansing-potion', 3]]);
  assert.equal(stacks[2].quantity, 8);
});

test('an opponent surrendering during skill selection is removed from the available targets', () => {
  const battle = newBattle('team', 'Команды', 'team', 'on-match', createCharacter('hero', 'Герой', seedContent), seedContent);
  joinBattle(battle, createCharacter('enemy', 'Противник', seedContent), 1);
  joinBattle(battle, createCharacter('other', 'Другой противник', seedContent), 1);
  startBattle(battle, () => 0);
  battle.effectsVersion = 1; battle.phase = 'choose'; battle.matchedElements = ['physical'];
  battle.fighters[0].skillEnergy = 3;
  applyAction(battle, 'enemy', { type: 'surrender' });
  assert.equal(battle.status, 'active'); assert.equal(battle.activeId, 'hero');
  assert.deepEqual(battle.skillChoices?.[0].targetIds, ['other']);
});

test('item command chooses the exact bottle composition rather than the first item with that ID', () => {
  const battle = duel(), actor = battle.fighters[0]; actor.hp = 20;
  actor.inventory = [
    { itemId: 'potion', quantity: 1, instanceId: 'weak', effects: [{ id: 'heal', kind: 'heal', recipient: 'caster', magnitude: { unit: 'hp', constant: 5 } }] },
    { itemId: 'potion', quantity: 1, instanceId: 'strong', effects: [{ id: 'heal', kind: 'heal', recipient: 'caster', magnitude: { unit: 'hp', constant: 35 } }] },
  ];
  applyAction(battle, 'hero', { type: 'item', itemId: 'potion', instanceId: 'strong' });
  assert.equal(battle.fighters[0].hp, 55);
  assert.deepEqual(battle.fighters[0].inventory.map(stack => stack.quantity), [1, 0]);
  assert.equal(battle.phase, 'before'); assert.equal(battle.usedSkill, true);
});
