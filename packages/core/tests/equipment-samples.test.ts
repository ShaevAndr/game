import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEquipmentSamples, applyInventoryCommand, calculateAttributes, combatStatDefinitions, defaultItemRanks,
  equipmentAttributeSources, seedContent, type InventoryState } from '../src';

const empty = (): InventoryState => ({ ownerId: 'hero', inventories: [{ id: 'bag', ownerId: 'hero', name: 'Рюкзак', capacity: 50, primary: true }], items: [] });
const ids = () => { let id = 0; return () => `item-${++id}`; };

test('equipment samples cover every rank of starting weapons/armor at item level 1, with saved modern rolls', () => {
  const content = structuredClone(seedContent);
  content.items = content.items.map(item => ({ ...item, itemLevel: 40 }));
  const source = empty(), samples = addEquipmentSamples(source, content, ids(), () => 0);
  assert.equal(source.items.length, 0);
  assert.equal(samples.result.createdItems!.length, 14);
  for (const itemId of ['iron-sword', 'leather-armor']) {
    const items = samples.state.items.filter(item => item.itemId === itemId);
    assert.deepEqual(items.map(item => item.quality!.rank.id), defaultItemRanks.map(rank => rank.id));
    for (const item of items) {
      assert.equal(item.itemLevel, 1); assert.equal(item.quality!.itemLevel, 1); assert.equal(item.quality!.version, 1);
      assert.equal(item.equippedSlot, null); assert.equal(item.inventoryId, 'bag');
      assert.equal(item.quality!.affixes.length, item.quality!.rank.order - 1);
      assert.ok(item.quality!.affixes.every(affix => affix.value >= affix.minValue! && affix.value <= affix.maxValue!));
    }
  }
  const otherRoll = addEquipmentSamples(source, content, ids(), max => max - 1);
  assert.notDeepEqual(samples.state.items.map(item => item.quality), otherRoll.state.items.map(item => item.quality));
  const snapshot = structuredClone(samples.state.items[0].quality);
  content.items.find(item => item.id === 'iron-sword')!.bonuses!.attack = 999;
  assert.deepEqual(samples.state.items[0].quality, snapshot);
});

test('sample affixes affect equipped attributes, without changing the character base; the rank itself adds no multiplier', () => {
  const samples = addEquipmentSamples(empty(), seedContent, ids(), () => 0);
  const character = { level: 1, definitions: combatStatDefinitions, baseAttributes: {} };
  const attributes = (state: InventoryState) => {
    const sources = equipmentAttributeSources(state, seedContent.items);
    return calculateAttributes({ ...character, equipmentModifiers: sources.modifiers, equipmentScaling: sources.scaling });
  };
  const common = samples.state.items.find(item => item.itemId === 'iron-sword' && item.quality!.rank.id === 'common')!;
  const mythic = samples.state.items.find(item => item.itemId === 'iron-sword' && item.quality!.rank.id === 'mythic')!;
  const commonState = applyInventoryCommand([samples.state], { type: 'equip', instanceId: common.id }, seedContent.items, seedContent.itemGroups, ids()).states[0];
  const mythicState = applyInventoryCommand([commonState], { type: 'equip', instanceId: mythic.id }, seedContent.items, seedContent.itemGroups, ids()).states[0];
  assert.deepEqual(attributes(commonState).base, attributes(mythicState).base);
  assert.notDeepEqual(attributes(commonState).equipped, attributes(mythicState).equipped);
  assert.deepEqual(common.quality!.baseSnapshot, mythic.quality!.baseSnapshot);
});

test('a full backpack rejects the entire sample set before generating items or consuming randomness', () => {
  const state = empty(); state.inventories[0].capacity = 13;
  const before = structuredClone(state);
  assert.throws(() => addEquipmentSamples(state, seedContent, () => { throw Error('ID consumed'); }, () => { throw Error('Roll consumed'); }), /недостаточно места/);
  assert.deepEqual(state, before);
});
