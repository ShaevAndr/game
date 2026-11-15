import type { Content } from './types';
import type { InventoryState, ItemInstance, InventoryResult } from './inventory';
import { defaultItemRanks, defaultModifierDefinitions, qualityForItem } from './item-progression';
import { defaultItemScalingProfiles } from './modifiers';

/** Development starting equipment uses the same saved rolls as crafted items. */
export function equipmentSampleDefinitions(content: Content) {
  return content.items.filter(item => content.balance.starterItems.some(stack => stack.itemId === item.id)
    && item.equipSlot && (item.groupId === 'weapons' || item.groupId === 'equipment'));
}

export const equipmentSampleSignature = (ownerId: string) => JSON.stringify({ type: 'seed-equipment-samples', ownerId });

export function addEquipmentSamples(input: InventoryState, content: Content, newId: () => string, roll: (max: number) => number) {
  const state = structuredClone(input), primary = state.inventories.find(bag => bag.primary);
  if (!primary) throw new Error('Рюкзак не найден');
  const ranks = [...(content.itemRanks ?? defaultItemRanks)].sort((a, b) => a.order - b.order);
  const definitions = equipmentSampleDefinitions(content);
  if (state.items.filter(item => item.inventoryId === primary.id && !item.equippedSlot).length + ranks.length * definitions.length > primary.capacity)
    throw new Error('Для набора экипировки недостаточно места в рюкзаке');
  const rules = { ...content, modifierRulesVersion: 1 as const,
    modifierDefinitions: content.modifierDefinitions ?? defaultModifierDefinitions,
    itemScalingProfiles: content.itemScalingProfiles ?? defaultItemScalingProfiles };
  const createdItems: ItemInstance[] = [];
  for (const definition of definitions) for (const rank of ranks) {
    const item = { ...definition, itemLevel: 1 };
    createdItems.push({ id: newId(), ownerId: state.ownerId, inventoryId: primary.id, itemId: item.id, quantity: 1,
      itemLevel: 1, definitionVersion: item.version ?? 1, equippedSlot: null,
      quality: qualityForItem(item, { mode: 'fixed', rankId: rank.id }, 1, rules, roll) });
  }
  state.items.push(...createdItems);
  const result: InventoryResult = { createdItems, itemIds: createdItems.map(item => item.id), deletedItemIds: [], inventoryId: primary.id };
  return { state, result };
}
