import { newLegacyBattle as newBattle } from './helpers/legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryCommand, InventoryState, applyAction, applyInventoryCommand, characterFighter, contentSchema, createCharacter, defaultItemGroups, effectiveStats, equipmentBonuses, grantSkill, normalizeCharacter, seedContent, skillLevel, skillPower, startBattle, upgradeSkill } from '../src';

function hero() { return createCharacter('hero', 'Герой', seedContent); }
function inventories(): InventoryState[] {
  return [
    { ownerId: 'a', inventories: [{ id: 'bag-a', ownerId: 'a', name: 'Рюкзак', capacity: 50, primary: true }, { id: 'chest', ownerId: 'a', name: 'Сундук', capacity: 1, primary: false }], items: [
      { id: 'ore', ownerId: 'a', inventoryId: 'bag-a', itemId: 'iron-ore', quantity: 8, equippedSlot: null },
      { id: 'sword', ownerId: 'a', inventoryId: 'bag-a', itemId: 'iron-sword', quantity: 1, equippedSlot: null },
      { id: 'scroll', ownerId: 'a', inventoryId: 'bag-a', itemId: 'ember-scroll', quantity: 1, equippedSlot: null },
    ] },
    { ownerId: 'b', inventories: [{ id: 'bag-b', ownerId: 'b', name: 'Рюкзак Б', capacity: 50, primary: true }], items: [] },
  ];
}
let sequence = 0;
const apply = (state: InventoryState[], command: InventoryCommand) => applyInventoryCommand(state, command, seedContent.items, defaultItemGroups, () => `new-${++sequence}`);
const count = (state: InventoryState[], itemId = 'iron-ore') => state.flatMap(owner => owner.items).filter(item => item.itemId === itemId).reduce((total, item) => total + item.quantity, 0);

test('skill grants are idempotent, cost no points and never upgrade an existing skill', () => {
  const character = hero();
  assert.equal(grantSkill(character, 'ember', seedContent), true);
  assert.equal(character.skillPoints, 4); assert.equal(skillLevel(character, 'ember'), 1);
  assert.equal(grantSkill(character, 'ember', seedContent), false);
  assert.equal(character.learnedSkillIds.filter(id => id === 'ember').length, 1);
});

test('skills have ten ranks, spend configured points and scale combat power', () => {
  const character = hero(); character.skillPoints = 20;
  const skill = seedContent.skills[0];
  for (let rank = 2; rank <= 10; rank++) { upgradeSkill(character, skill.id, seedContent); assert.equal(skillLevel(character, skill.id), rank); }
  assert.equal(character.skillPoints, 11); assert.equal(skillPower(skill, 10), skill.power + 18);
  const before = structuredClone(character);
  assert.throws(() => upgradeSkill(character, skill.id, seedContent), /максимальный/);
  assert.deepEqual(character, before);
});

test('unlearned or unaffordable upgrades do not change the character', () => {
  const character = hero(); character.skillPoints = 0;
  const before = structuredClone(character);
  assert.throws(() => upgradeSkill(character, 'ember', seedContent), /изучите/);
  assert.throws(() => upgradeSkill(character, 'strike', seedContent), /очков/);
  assert.deepEqual(character, before);
});

test('legacy learned skills become rank one and new battles freeze ranks and equipment bonuses', () => {
  const character = hero(); delete character.skillLevels;
  const normalized = normalizeCharacter(character, seedContent);
  assert.equal(normalized.skillLevels?.strike, 1);
  normalized.equipmentBonuses = { attack: 3 }; upgradeSkill(normalized, 'strike', seedContent);
  const battle = newBattle('battle', 'Тест', 'bot', 'before', normalized, seedContent); startBattle(battle);
  upgradeSkill(normalized, 'strike', seedContent);
  assert.equal(battle.fighters[0].skillLevels?.strike, 2);
  assert.equal(battle.fighters[1].skillLevels?.strike, 2);
  assert.equal(battle.fighters[0].stats.attack, normalized.stats.attack + 3);
  const previousHp = battle.fighters[1].hp;
  battle.fighters[0].energy.physical = 3;
  applyAction(battle, 'hero', { type: 'skill', skillId: 'strike', targetId: battle.fighters[1].id });
  assert.equal(previousHp - battle.fighters[1].hp, seedContent.skills[0].power + 2 + battle.fighters[0].stats.attack - battle.fighters[1].stats.defense);
  assert.equal(effectiveStats(normalized).attack, normalized.stats.attack + 3);
});

test('removal detaches an instance, placement preserves it, and deleting really removes it', () => {
  const detached = apply(inventories(), { type: 'remove', instanceId: 'ore', quantity: 8 });
  assert.equal(detached.states[0].items.find(item => item.id === 'ore')?.inventoryId, null);
  assert.equal(count(detached.states), 8);
  const placed = apply(detached.states, { type: 'put', instanceId: 'ore', targetInventoryId: 'chest', quantity: 8 });
  assert.equal(placed.states[0].items.find(item => item.id === 'ore')?.inventoryId, 'chest');
  const deleted = apply(placed.states, { type: 'delete', instanceId: 'ore', quantity: 8 });
  assert.equal(count(deleted.states), 0); assert.deepEqual(deleted.result.deletedItemIds, ['ore']);
});

test('partial transfers conserve quantity and full cross-owner transfers preserve identity', () => {
  const partial = apply(inventories(), { type: 'transfer', instanceId: 'ore', targetInventoryId: 'chest', quantity: 3 });
  assert.equal(count(partial.states), 8);
  assert.equal(partial.states[0].items.find(item => item.id === 'ore')?.quantity, 5);
  const transferred = apply(partial.states, { type: 'transfer', instanceId: 'ore', targetInventoryId: 'bag-b', quantity: 5 });
  assert.equal(count(transferred.states), 8);
  assert.ok(!transferred.states[0].items.some(item => item.id === 'ore'));
  assert.equal(transferred.states[1].items.find(item => item.id === 'ore')?.ownerId, 'b');
});

test('failed transfers to full inventories cannot lose or duplicate items', () => {
  const state = apply(inventories(), { type: 'transfer', instanceId: 'ore', targetInventoryId: 'chest', quantity: 2 }).states;
  const before = structuredClone(state);
  assert.throws(() => apply(state, { type: 'transfer', instanceId: 'sword', targetInventoryId: 'chest', quantity: 1 }), /заполнен/);
  assert.deepEqual(state, before);
});

test('stack split and merge conserve total quantity and enforce limits', () => {
  const split = apply(inventories(), { type: 'split', instanceId: 'ore', quantity: 3 });
  const splitId = split.result.itemIds.find(id => id !== 'ore')!;
  const merged = apply(split.states, { type: 'merge', instanceId: splitId, targetInstanceId: 'ore' });
  assert.equal(count(merged.states), 8); assert.equal(merged.states[0].items.find(item => item.id === 'ore')?.quantity, 8);
  assert.ok(!merged.states[0].items.some(item => item.id === splitId));
  const overflow = structuredClone(split.states); overflow[0].items.find(item => item.id === 'ore')!.quantity = 998;
  assert.throws(() => apply(overflow, { type: 'merge', instanceId: splitId, targetInstanceId: 'ore' }), /размер/);
});

test('equipped items grant bonuses and must be unequipped before moving or destruction', () => {
  const equipped = apply(inventories(), { type: 'equip', instanceId: 'sword' });
  assert.deepEqual(equipmentBonuses(equipped.states[0], seedContent.items), { attack: 3 });
  assert.throws(() => apply(equipped.states, { type: 'delete', instanceId: 'sword', quantity: 1 }), /снимите/);
  assert.throws(() => apply(equipped.states, { type: 'transfer', instanceId: 'sword', targetInventoryId: 'chest', quantity: 1 }), /снимите/);
  const unequipped = apply(equipped.states, { type: 'unequip', instanceId: 'sword' });
  assert.deepEqual(equipmentBonuses(unequipped.states[0], seedContent.items), {});
});

test('scroll consumption emits a grant effect and unsupported item actions fail', () => {
  const consumed = apply(inventories(), { type: 'read', instanceId: 'scroll' });
  assert.deepEqual(consumed.effects, [{ ownerId: 'a', skillId: 'ember' }]);
  assert.ok(!consumed.states[0].items.some(item => item.id === 'scroll'));
  assert.throws(() => apply(inventories(), { type: 'read', instanceId: 'sword' }), /группы/);
});

test('groups extend through data and existing handlers, without a category switch', () => {
  const content = structuredClone(seedContent);
  content.itemGroups!.push({ id: 'relics', name: 'Реликвии', description: '', actions: ['equip', 'unequip'] });
  content.items.push({ id: 'relic', name: 'Реликвия', description: '', groupId: 'relics', stackLimit: 1, equipSlot: 'neck', bonuses: { maxEnergy: 5 } });
  assert.equal(contentSchema.safeParse(content).success, true);
  const state = inventories(); state[0].items.push({ id: 'relic-instance', ownerId: 'a', inventoryId: 'bag-a', itemId: 'relic', quantity: 1, equippedSlot: null });
  const result = applyInventoryCommand(state, { type: 'equip', instanceId: 'relic-instance' }, content.items, content.itemGroups, () => 'unused');
  assert.equal(result.states[0].items.find(item => item.id === 'relic-instance')?.equippedSlot, 'neck');
});

test('receiving respects stack limits and invalid quantities cannot mutate state', () => {
  const state = inventories();
  const received = apply(state, { type: 'receive', ownerId: 'a', itemId: 'potion', quantity: 201 });
  assert.deepEqual(received.states[0].items.filter(item => item.itemId === 'potion').map(item => item.quantity), [99, 99, 3]);
  for (const quantity of [-1, 0, 0.5, Infinity, NaN, 9]) assert.throws(() => apply(state, { type: 'delete', instanceId: 'ore', quantity }));
  assert.equal(count(state), 8);
});

test('weapons and resources cannot be consumed as healing potions in battle', () => {
  const battle = newBattle('battle', 'Тест', 'bot', 'before', hero(), seedContent); startBattle(battle);
  battle.fighters[0].hp = 60;
  const before = structuredClone(battle);
  assert.throws(() => applyAction(battle, 'hero', { type: 'item', itemId: 'iron-sword' }), /недоступен/);
  assert.deepEqual(battle, before);
});

test('new potions and custom skill growth work from catalog data', () => {
  const content = structuredClone(seedContent);
  content.skills[0].progression = { maxLevel: 10, pointCost: 2, powerPerLevel: 7 };
  content.items.push({ id: 'minor-potion', name: 'Малое зелье', description: '', groupId: 'potions', stackLimit: 10, heal: 9 });
  const character = hero();
  upgradeSkill(character, 'strike', content);
  assert.equal(character.skillPoints, 2); assert.equal(skillPower(content.skills[0], 2), content.skills[0].power + 7);
  character.inventory.push({ itemId: 'minor-potion', quantity: 2 });
  const battle = newBattle('battle', 'Тест', 'bot', 'before', character, content); startBattle(battle);
  battle.fighters[0].hp = 30;
  applyAction(battle, character.id, { type: 'item', itemId: 'minor-potion' });
  assert.equal(battle.fighters[0].hp, 39);
  assert.equal(battle.fighters[0].inventory.find(item => item.itemId === 'minor-potion')?.quantity, 1);
  assert.equal(character.inventory.find(item => item.itemId === 'minor-potion')?.quantity, 2);
});
