import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCraftRecipe, contentSchema, knownRecipes, matchingCraftRecipes, resolveBlindCraft, seedContent, type CraftingRecipe, type InventoryState } from '../src';

let serial = 0;
const id = () => `instance-${++serial}`;
function backpack(ownerId: string, items: [string, number][]): InventoryState {
  return { ownerId, inventories: [{ id: ownerId, ownerId, name: 'Рюкзак', capacity: 50, primary: true }], items: items.map(([itemId, quantity]) => ({ id: id(), ownerId, inventoryId: ownerId, itemId, quantity, equippedSlot: null })) };
}
function total(state: InventoryState, itemId: string) { return state.items.filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0); }
const recipe = (id: string) => seedContent.recipes!.find(value => value.id === id)!;

test('seeded recipes pass content validation and basic recipes are known by default', () => {
  assert.ok(contentSchema.safeParse(seedContent).success);
  assert.equal(knownRecipes(seedContent.recipes!).length, 3);
  assert.ok(knownRecipes(seedContent.recipes!).every(recipe => recipe.knownByDefault));
});

test('matching recipes require the exact material multiset, ignoring ingredient order', () => {
  assert.deepEqual(matchingCraftRecipes([{ itemId: 'iron-ore', quantity: 6 }], seedContent.recipes!).map(value => value.id), ['craft-iron-sword']);
  assert.deepEqual(matchingCraftRecipes([{ itemId: 'leather', quantity: 4 }], seedContent.recipes!).map(value => value.id), ['craft-leather-armor']);
  const mixed = [{ itemId: 'iron-ore', quantity: 2 }, { itemId: 'healing-herb', quantity: 3 }];
  assert.deepEqual(matchingCraftRecipes(mixed, seedContent.recipes!).map(value => value.id), ['craft-ember-scroll']);
  assert.deepEqual(matchingCraftRecipes([...mixed].reverse(), seedContent.recipes!).map(value => value.id), ['craft-ember-scroll']);
  assert.deepEqual(matchingCraftRecipes([{ itemId: 'iron-ore', quantity: 5 }], seedContent.recipes!), []);
  assert.deepEqual(matchingCraftRecipes([], seedContent.recipes!), []);
});

test('crafting consumes exact materials from the backpack and creates the outputs', () => {
  const before = backpack('owner', [['iron-ore', 8], ['healing-herb', 2]]);
  const applied = applyCraftRecipe(before, recipe('craft-iron-sword'), seedContent.items, id);
  assert.equal(total(applied.state, 'iron-ore'), 2);
  assert.equal(total(applied.state, 'healing-herb'), 2);
  assert.equal(total(applied.state, 'iron-sword'), 1);
  const sword = applied.state.items.find(item => item.itemId === 'iron-sword');
  assert.ok(sword);
  assert.ok(applied.result.itemIds.includes(sword.id), 'the created instance is reported');
  assert.equal(applied.result.deletedItemIds.length, 0);
  assert.equal(total(before, 'iron-ore'), 8, 'the input state stays untouched');
  assert.equal(total(before, 'iron-sword'), 0);
});

test('a failed craft never partially consumes materials', () => {
  const before = backpack('owner', [['iron-ore', 5]]);
  const expected = structuredClone(before);
  assert.throws(() => applyCraftRecipe(before, recipe('craft-iron-sword'), seedContent.items, id), /Недостаточно материала/);
  assert.deepEqual(before, expected);
});

test('outputs split by the stack limit and the backpack capacity is enforced', () => {
  const many = (name: string, quantity: number, ingredients: [string, number][]): CraftingRecipe => ({ id: name, name, description: '', kind: 'craft', knownByDefault: true, inputs: ingredients.map(([itemId, q]) => ({ itemId, quantity: q })), outputs: [{ itemId: 'potion', quantity }] });
  const state = backpack('owner', [['healing-herb', 100]]);
  const applied = applyCraftRecipe(state, many('bulk', 100, [['healing-herb', 100]]), seedContent.items, id);
  const stacks = applied.state.items.filter(item => item.itemId === 'potion').map(item => item.quantity);
  assert.deepEqual(stacks, [99, 1]);
  const manySwords: CraftingRecipe = { id: 'many-swords', name: 'Много мечей', description: '', kind: 'craft', knownByDefault: true, inputs: [{ itemId: 'iron-ore', quantity: 1 }], outputs: [{ itemId: 'iron-sword', quantity: 10 }] };
  const full = backpack('owner', [['iron-ore', 1], ...Array.from({ length: 49 }, () => ['healing-herb', 1] as [string, number])]);
  assert.throws(() => applyCraftRecipe(full, manySwords, seedContent.items, id), /Рюкзак заполнен/);
});

test('blind craft returns materials when nothing matches', () => {
  const rolls: number[] = [];
  const outcome = resolveBlindCraft(backpack('owner', [['iron-ore', 5]]), [{ itemId: 'iron-ore', quantity: 5 }], seedContent.recipes!, seedContent.items, { successBps: 4000, lossBps: 5000 }, id, max => { rolls.push(max); return 0; });
  assert.deepEqual(outcome, { outcome: 'nothing', materialsReturned: true });
  assert.deepEqual(rolls, []);
});

test('blind craft success picks a random matching recipe and consumes materials', () => {
  const state = backpack('owner', [['healing-herb', 3], ['iron-ore', 2]]);
  const rolls: number[] = [];
  const outcome = resolveBlindCraft(state, [{ itemId: 'healing-herb', quantity: 3 }, { itemId: 'iron-ore', quantity: 2 }], seedContent.recipes!, seedContent.items, { successBps: 4000, lossBps: 5000 }, id, max => { rolls.push(max); return 0; });
  assert.equal(outcome.outcome, 'crafted');
  assert.equal(rolls[0], 10000); assert.equal(rolls[1], 1);
  if (outcome.outcome !== 'crafted') return;
  assert.equal(total(outcome.state, 'ember-scroll'), 1);
  assert.equal(total(outcome.state, 'healing-herb'), 0);
  assert.equal(total(outcome.state, 'iron-ore'), 0);
});

test('blind craft failure returns or loses materials according to the loss roll', () => {
  const selection = [{ itemId: 'healing-herb', quantity: 3 }, { itemId: 'iron-ore', quantity: 2 }];
  const rolls = (values: number[]) => values.length ? (max: number) => values.shift()! : () => 0;
  const lost = resolveBlindCraft(backpack('owner', [['healing-herb', 3], ['iron-ore', 2]]), selection, seedContent.recipes!, seedContent.items, { successBps: 4000, lossBps: 5000 }, id, rolls([5000, 4000]));
  assert.equal(lost.outcome, 'nothing'); assert.equal(lost.materialsReturned, false);
  assert.ok(lost.state, 'lost materials must be persisted as consumption');
  if (lost.outcome !== 'nothing' || !lost.state) return;
  assert.equal(total(lost.state, 'healing-herb'), 0); assert.equal(total(lost.state, 'iron-ore'), 0);
  const returned = resolveBlindCraft(backpack('owner', [['healing-herb', 3], ['iron-ore', 2]]), selection, seedContent.recipes!, seedContent.items, { successBps: 4000, lossBps: 5000 }, id, rolls([5000, 6000]));
  assert.equal(returned.outcome, 'nothing'); assert.equal(returned.materialsReturned, true);
  if (returned.outcome !== 'nothing') return;
  assert.equal(returned.state, undefined, 'returned materials need no inventory change');
});
