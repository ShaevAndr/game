import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGatheringAction, applyCraftRecipe, gatheringCatalog, gatheringView, initialGatheringState, receiveInventoryItems, runGatheringMinigame, seedContent, validateGatheringCatalog, type GatheringAction, type GatheringState, type InventoryState } from '../src';

let sequence = 0;
const newId = () => `id-${++sequence}`;
const inventory = (): InventoryState => ({ ownerId: 'hero', inventories: [{ id: 'bag', ownerId: 'hero', name: 'Рюкзак', primary: true, capacity: 50 }], items: [] });
const apply = (state: GatheringState, action: GatheringAction, bag = inventory(), roll = (_: number) => 0) => applyGatheringAction(state, action, gatheringCatalog, bag, newId, roll);
const start = (areaId = 'forest', routeId = 'forest-edge') => apply(initialGatheringState(), { type: 'start', areaId, routeId }).state;

test('catalog references are valid, every material has a recipe and every route has hand-accessible common resources', () => {
  validateGatheringCatalog(gatheringCatalog, seedContent.items);
  for (const resource of gatheringCatalog.resources) for (const method of resource.methods) for (const loot of [method.output, ...(method.bonus ? [method.bonus] : [])]) {
    assert.ok(seedContent.recipes!.some(recipe => recipe.inputs.some(input => input.itemId === loot.itemId)), `Unused material ${loot.itemId}`);
  }
  for (const area of gatheringCatalog.areas) for (const route of area.routes) {
    const resource = gatheringCatalog.resources.find(resource => resource.id === route.commonResourceId)!;
    assert.equal(resource.level, 1); assert.ok(resource.methods.some(method => !method.toolItemId));
  }
  const broken = structuredClone(gatheringCatalog); broken.resources[0].methods[0].output.itemId = 'missing';
  assert.throws(() => validateGatheringCatalog(broken, seedContent.items));
});

test('REST projection hides future stops, preserves discoveries and does not mutate or reroll the expedition', () => {
  const state = start(); const before = structuredClone(state);
  const view = gatheringView(state, gatheringCatalog, inventory(), seedContent.items);
  assert.equal(view.expedition!.totalSteps, 4); assert.equal(view.expedition!.resources.length, 3);
  assert.equal('sites' in view.expedition!, false);
  assert.deepEqual(gatheringView(state, gatheringCatalog, inventory(), seedContent.items), view);
  assert.deepEqual(state, before);
  const skipped = apply(state, { type: 'skip' }).state;
  assert.ok(before.discoveredResourceIds.every(id => skipped.discoveredResourceIds.includes(id)));
  assert.throws(() => apply(state, { type: 'start', areaId: 'forest', routeId: 'forest-edge' }), /Сначала вернитесь/);
  assert.throws(() => start('forest', 'crystal-fault'), /маршрут/);
});

test('harvesting calls the resource/level-specific entry point, accumulates cargo and awards only gathering XP', () => {
  const state = start();
  const result = applyGatheringAction(state, { type: 'harvest', resourceId: 'herb-patch', methodId: 'pick' }, gatheringCatalog, inventory(), newId, () => 0, context => {
    assert.deepEqual(context, { resourceId: 'herb-patch', resourceType: 'plant', resourceLevel: 1, methodId: 'pick' });
    return runGatheringMinigame(context);
  });
  assert.deepEqual(result.outcome.loot, [{ itemId: 'healing-herb', quantity: 3 }]);
  assert.equal(result.state.xp, 1); assert.equal(result.state.expedition!.step, 1);
  assert.deepEqual(result.state.expedition!.cargo, result.outcome.loot);
  assert.deepEqual(result.returned, []); assert.equal(state.xp, 0);
  for (const resource of gatheringCatalog.resources) for (const method of resource.methods) assert.equal(runGatheringMinigame({ resourceId: resource.id, resourceType: resource.type, resourceLevel: resource.level, methodId: method.id }), true);
});

test('a future failed minigame consumes the stop without cargo or XP; blocked attempts never call it', () => {
  const state = start();
  const fail = applyGatheringAction(state, { type: 'harvest', resourceId: 'herb-patch', methodId: 'pick' }, gatheringCatalog, inventory(), newId, () => 0, () => false);
  assert.equal(fail.outcome.success, false); assert.equal(fail.state.xp, 0); assert.equal(fail.state.expedition!.step, 1);
  assert.deepEqual(fail.state.expedition!.cargo, []);
  assert.throws(() => applyGatheringAction(state, { type: 'harvest', resourceId: 'fallen-oak', methodId: 'cut' }, gatheringCatalog, inventory(), newId, () => 0, () => { assert.fail('Blocked call'); }), /инструмент/);
  assert.throws(() => apply(state, { type: 'harvest', resourceId: 'fire-geode', methodId: 'extract' }), /отсутствует/);
  assert.throws(() => apply(state, { type: 'harvest', resourceId: 'herb-patch', methodId: 'mine' }), /Способ/);
});

test('resource level and tool location are authoritative, and a tool changes the available extraction method', () => {
  const state = start(); state.expedition!.sites[0] = ['water-geode'];
  assert.throws(() => apply(state, { type: 'harvest', resourceId: 'water-geode', methodId: 'extract' }), /уровень собирателя 2/);
  state.xp = 10;
  let bag = receiveInventoryItems(inventory(), [{ itemId: 'crystal-chisel', quantity: 1 }], seedContent.items, newId);
  bag.items[0].inventoryId = null;
  assert.throws(() => apply(state, { type: 'harvest', resourceId: 'water-geode', methodId: 'extract' }, bag), /инструмент/);
  bag.items[0].inventoryId = 'bag';
  const result = apply(state, { type: 'harvest', resourceId: 'water-geode', methodId: 'extract' }, bag);
  assert.deepEqual(result.outcome.loot, [{ itemId: 'water-crystal', quantity: 1 }]);
  assert.equal(result.state.xp, 12); assert.equal(bag.items[0].quantity, 1);
});

test('base yield is guaranteed and river placer bonus is rolled independently', () => {
  const state = start('marsh', 'reed-bank'); state.expedition!.sites[0] = ['river-placer'];
  const action: GatheringAction = { type: 'harvest', resourceId: 'river-placer', methodId: 'wash' };
  assert.deepEqual(apply(state, action).outcome.loot, [{ itemId: 'river-sand', quantity: 3 }, { itemId: 'copper-ore', quantity: 1 }]);
  assert.deepEqual(apply(state, action, inventory(), () => 9999).outcome.loot, [{ itemId: 'river-sand', quantity: 3 }]);
});

test('full cargo blocks all partial gains and both early and completed routes allow returning', () => {
  const state = start(); state.expedition!.cargo = [{ itemId: 'oak-wood', quantity: 23 }];
  assert.throws(() => apply(state, { type: 'harvest', resourceId: 'herb-patch', methodId: 'pick' }), /места в грузе/);
  assert.equal(state.xp, 0); assert.equal(state.expedition!.cargo[0].quantity, 23);
  const returned = apply(state, { type: 'return' });
  assert.equal(returned.state.expedition, null); assert.equal(returned.returned[0].quantity, 23);
  let completed = start();
  for (let i = 0; i < 4; i++) completed = apply(completed, { type: 'skip' }).state;
  assert.throws(() => apply(completed, { type: 'skip' }), /Маршрут завершён/);
  assert.equal(apply(completed, { type: 'return' }).state.expedition, null);
});

test('batch grants fill matching stacks, preserve differing payloads and reject overflow without mutation', () => {
  let bag = inventory(); bag.inventories[0].capacity = 1;
  bag = receiveInventoryItems(bag, [{ itemId: 'healing-herb', quantity: 998 }], seedContent.items, newId);
  const before = structuredClone(bag);
  const merged = receiveInventoryItems(bag, [{ itemId: 'healing-herb', quantity: 1 }], seedContent.items, newId);
  assert.equal(merged.items.length, 1); assert.equal(merged.items[0].quantity, 999);
  assert.throws(() => receiveInventoryItems(bag, [{ itemId: 'healing-herb', quantity: 2 }], seedContent.items, newId), /Рюкзак заполнен/);
  assert.deepEqual(bag, before);
  bag.items[0].itemLevel = 2;
  assert.throws(() => receiveInventoryItems(bag, [{ itemId: 'healing-herb', quantity: 1 }], seedContent.items, newId), /Рюкзак заполнен/);
});

test('the first harvesting tools can be crafted solely from materials gathered by hand', () => {
  const materials = [{ itemId: 'oak-wood', quantity: 8 }, { itemId: 'flint', quantity: 7 }];
  const handItems = gatheringCatalog.resources.filter(resource => resource.level === 1).flatMap(resource => resource.methods.filter(method => !method.toolItemId).map(method => method.output.itemId));
  assert.ok(materials.every(material => handItems.includes(material.itemId)));
  let bag = receiveInventoryItems(inventory(), materials, seedContent.items, newId);
  for (const id of ['craft-woodcutting-axe', 'craft-herbal-sickle', 'craft-mining-pick']) bag = applyCraftRecipe(bag, seedContent.recipes!.find(recipe => recipe.id === id)!, seedContent.items, newId).state;
  for (const id of ['woodcutting-axe', 'herbal-sickle', 'mining-pick']) assert.ok(bag.items.some(item => item.itemId === id));
});
