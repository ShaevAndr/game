import type { Item, ItemStack, Stats } from './types';
import { defaultItemGroups, ItemGroup, itemActionNames, ItemActionId } from './items';
import { legacyEquipmentAttributes } from './attributes/equipment';
import type { ScaledEquipmentBonus, StatDefinition, StatModifier } from './attributes/types';

export interface InventoryContainer { id: string; ownerId: string; name: string; capacity: number; primary: boolean }
export interface ItemInstance { id: string; ownerId: string; inventoryId: string | null; itemId: string; quantity: number; equippedSlot: string | null }
export interface InventoryState { ownerId: string; inventories: InventoryContainer[]; items: ItemInstance[] }
export interface InventoryView extends InventoryState { items: (ItemInstance & { actions: AvailableItemAction[] })[]; definitions: Item[]; groups: ItemGroup[]; statDefinitions?: StatDefinition[] }
export interface InventoryResult { itemIds: string[]; deletedItemIds: string[]; inventoryId?: string }
export interface InventoryEffect { ownerId: string; skillId: string }
export type InventoryCommand =
  | { type: 'receive'; ownerId: string; itemId: string; quantity: number; inventoryId?: string | null }
  | { type: 'create-inventory'; ownerId: string; name: string; capacity: number }
  | { type: 'delete' | 'remove' | 'split'; instanceId: string; quantity: number }
  | { type: 'transfer' | 'put'; instanceId: string; targetInventoryId: string; quantity: number }
  | { type: 'merge'; instanceId: string; targetInstanceId: string }
  | { type: 'equip' | 'unequip' | 'read'; instanceId: string };

function positive(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Количество должно быть положительным целым числом');
}
export function backpackStacks(state: InventoryState): ItemStack[] {
  const primary = state.inventories.find(inventory => inventory.primary);
  const totals = new Map<string, number>();
  for (const item of state.items.filter(item => item.inventoryId === primary?.id && !item.equippedSlot)) totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.quantity);
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
}
export function equipmentBonuses(state: InventoryState, definitions: Item[]): Partial<Stats> {
  const result: Partial<Stats> = {};
  for (const item of state.items.filter(item => item.equippedSlot)) {
    for (const [key, value] of Object.entries(definitions.find(definition => definition.id === item.itemId)?.bonuses ?? {}) as [keyof Stats, number][]) result[key] = (result[key] ?? 0) + value;
  }
  return result;
}

export function equipmentAttributeSources(state: InventoryState, definitions: Item[]) {
  const modifiers: StatModifier[] = [], scaling: ScaledEquipmentBonus[] = [];
  for (const instance of state.items.filter(item => item.equippedSlot)) {
    const definition = definitions.find(item => item.id === instance.itemId);
    if (!definition) throw new Error('Описание экипировки не найдено');
    const legacy = legacyEquipmentAttributes(definition.bonuses ?? {}, instance.id);
    modifiers.push(...legacy.modifiers); scaling.push(...legacy.scaling);
    for (const [index, modifier] of (definition.statModifiers ?? []).entries()) modifiers.push({ ...modifier, id: `${instance.id}:modifier:${index}`, sourceId: instance.id });
    for (const [index, bonus] of (definition.scaledBonuses ?? []).entries()) scaling.push({ ...bonus, id: `${instance.id}:scaling:${index}`, sourceId: instance.id });
  }
  return { modifiers, scaling };
}

export function equipmentRequirementBlockers(item: Item, baseAttributes: Record<string, number>, definitions: StatDefinition[]): string[] {
  return Object.entries(item.attributeRequirements ?? {}).filter(([id, minimum]) => (baseAttributes[id] ?? 0) < minimum)
    .map(([id, minimum]) => `Нужно: ${definitions.find(definition => definition.id === id)?.name ?? id} ${minimum}`);
}

/** Clones its inputs: failed operations never partially mutate a caller's state. */
export function applyInventoryCommand(input: InventoryState[], command: InventoryCommand, definitions: Item[], groups: ItemGroup[] = defaultItemGroups, newId: () => string) {
  const states = structuredClone(input);
  const result: InventoryResult = { itemIds: [], deletedItemIds: [] };
  const effects: InventoryEffect[] = [];
  const owner = (id: string) => { const state = states.find(state => state.ownerId === id); if (!state) throw new Error('Владелец не найден'); return state; };
  const find = (id: string) => {
    for (const state of states) { const instance = state.items.find(item => item.id === id); if (instance) return { state, instance }; }
    throw new Error('Экземпляр предмета не найден');
  };
  const container = (id: string) => {
    for (const state of states) { const inventory = state.inventories.find(inventory => inventory.id === id); if (inventory) return { state, inventory }; }
    throw new Error('Инвентарь не найден');
  };
  const definition = (id: string) => { const item = definitions.find(item => item.id === id); if (!item) throw new Error('Описание предмета не найдено'); return item; };
  const capability = (instance: ItemInstance, action: ItemActionId) => {
    const item = definition(instance.itemId);
    if (!groups.find(group => group.id === item.groupId)?.actions.includes(action)) throw new Error('Действие недоступно для группы предмета');
    return item;
  };
  const movable = (instance: ItemInstance) => { if (instance.equippedSlot) throw new Error('Сначала снимите предмет'); };
  const take = (state: InventoryState, instance: ItemInstance, quantity: number) => {
    positive(quantity); movable(instance);
    if (quantity > instance.quantity) throw new Error('Недостаточно предметов');
    if (quantity === instance.quantity) { state.items = state.items.filter(item => item.id !== instance.id); return instance; }
    instance.quantity -= quantity;
    return { ...instance, id: newId(), quantity };
  };
  const removeQuantity = (state: InventoryState, instance: ItemInstance, quantity: number) => {
    const removed = take(state, instance, quantity);
    if (removed.id === instance.id) result.deletedItemIds.push(instance.id);
    else result.itemIds.push(instance.id);
  };

  if (command.type === 'create-inventory') {
    const state = owner(command.ownerId);
    if (!Number.isInteger(command.capacity) || command.capacity < 1 || command.capacity > 200) throw new Error('Вместимость должна быть от 1 до 200');
    if (state.inventories.length >= 20) throw new Error('Достигнут лимит инвентарей');
    const inventory = { id: newId(), ownerId: state.ownerId, name: command.name, capacity: command.capacity, primary: false };
    state.inventories.push(inventory); result.inventoryId = inventory.id;
  } else if (command.type === 'receive') {
    positive(command.quantity);
    if (command.quantity > 99999) throw new Error('Слишком большое количество предметов');
    const state = owner(command.ownerId), item = definition(command.itemId);
    const inventoryId = command.inventoryId === undefined ? state.inventories.find(inventory => inventory.primary)?.id : command.inventoryId;
    if (inventoryId === undefined || (inventoryId && container(inventoryId).state.ownerId !== state.ownerId)) throw new Error('Инвентарь не принадлежит получателю');
    for (let remaining = command.quantity; remaining > 0;) {
      const quantity = Math.min(remaining, item.stackLimit);
      const instance: ItemInstance = { id: newId(), ownerId: state.ownerId, inventoryId, itemId: item.id, quantity, equippedSlot: null };
      state.items.push(instance); result.itemIds.push(instance.id); remaining -= quantity;
    }
  } else {
    const { state, instance } = find(command.instanceId);
    if (command.type === 'delete') removeQuantity(state, instance, command.quantity);
    else if (command.type === 'remove') {
      if (!instance.inventoryId) throw new Error('Предмет уже вне инвентаря');
      const detached = take(state, instance, command.quantity);
      detached.inventoryId = null; state.items.push(detached); result.itemIds.push(detached.id);
    } else if (command.type === 'transfer' || command.type === 'put') {
      if (command.type === 'put' && instance.inventoryId) throw new Error('Предмет уже в инвентаре; используйте перенос');
      if (command.type === 'transfer' && !instance.inventoryId) throw new Error('Предмет вне инвентаря; используйте размещение');
      if (instance.inventoryId === command.targetInventoryId) throw new Error('Выберите другой инвентарь');
      const destination = container(command.targetInventoryId);
      const moved = take(state, instance, command.quantity);
      moved.ownerId = destination.state.ownerId; moved.inventoryId = destination.inventory.id;
      destination.state.items.push(moved); result.itemIds.push(moved.id);
    } else {
      const handlers: Partial<Record<InventoryCommand['type'], () => void>> = {
        split: () => {
          capability(instance, 'split');
          if (command.type !== 'split') return;
          if (command.quantity >= instance.quantity) throw new Error('Для разделения выберите часть стэка');
          const split = take(state, instance, command.quantity); state.items.push(split); result.itemIds.push(instance.id, split.id);
        },
        merge: () => {
          capability(instance, 'merge'); movable(instance);
          if (command.type !== 'merge') return;
          const target = find(command.targetInstanceId).instance;
          movable(target);
          if (target.id === instance.id || target.ownerId !== instance.ownerId || target.inventoryId !== instance.inventoryId || target.itemId !== instance.itemId) throw new Error('Объединять можно одинаковые предметы в одном инвентаре');
          if (target.quantity + instance.quantity > definition(instance.itemId).stackLimit) throw new Error('Превышен размер стэка');
          target.quantity += instance.quantity; state.items = state.items.filter(item => item.id !== instance.id);
          result.itemIds.push(target.id); result.deletedItemIds.push(instance.id);
        },
        equip: () => {
          const item = capability(instance, 'equip');
          if (!item.equipSlot || instance.quantity !== 1) throw new Error('Предмет нельзя экипировать');
          if (instance.equippedSlot) throw new Error('Предмет уже экипирован');
          if (!state.inventories.find(inventory => inventory.id === instance.inventoryId)?.primary) throw new Error('Экипировать можно только из рюкзака');
          const previous = state.items.find(other => other.equippedSlot === item.equipSlot);
          if (previous) { previous.equippedSlot = null; result.itemIds.push(previous.id); }
          instance.equippedSlot = item.equipSlot; result.itemIds.push(instance.id);
        },
        unequip: () => {
          capability(instance, 'unequip');
          if (!instance.equippedSlot) throw new Error('Предмет не экипирован');
          instance.equippedSlot = null; result.itemIds.push(instance.id);
        },
        read: () => {
          const item = capability(instance, 'read');
          if (!item.grantedSkillId) throw new Error('Свиток не содержит навыка');
          if (!state.inventories.find(inventory => inventory.id === instance.inventoryId)?.primary) throw new Error('Свиток нужно положить в рюкзак');
          removeQuantity(state, instance, 1); effects.push({ ownerId: state.ownerId, skillId: item.grantedSkillId });
        },
      };
      const handler = handlers[command.type];
      if (!handler) throw new Error('Неизвестная операция');
      handler();
    }
  }
  for (const state of states) {
    if (state.items.length > 5000) throw new Error('Достигнут лимит предметов владельца');
    for (const inventory of state.inventories) {
      if (state.items.filter(item => item.inventoryId === inventory.id && !item.equippedSlot).length > inventory.capacity) throw new Error(`Инвентарь «${inventory.name}» заполнен`);
    }
    for (const instance of state.items) {
      positive(instance.quantity);
      if (instance.quantity > definition(instance.itemId).stackLimit) throw new Error('Превышен размер стэка');
      if (instance.ownerId !== state.ownerId || (instance.inventoryId && !state.inventories.some(inventory => inventory.id === instance.inventoryId))) throw new Error('Нарушена принадлежность предмета');
    }
  }
  return { states, result, effects };
}

export interface AvailableItemAction { id: string; label: string; enabled: boolean; reason?: string }
export function availableItemActions(instance: ItemInstance, state: InventoryState, item: Item, groups: ItemGroup[]): AvailableItemAction[] {
  const equipped = !!instance.equippedSlot;
  const primary = state.inventories.find(inventory => inventory.primary)?.id === instance.inventoryId;
  const actions: AvailableItemAction[] = [
    { id: 'inspect', label: 'Описание', enabled: true },
    { id: 'delete', label: 'Удалить', enabled: !equipped },
    { id: instance.inventoryId ? 'transfer' : 'put', label: instance.inventoryId ? 'Перенести' : 'Положить', enabled: !equipped },
    ...(instance.inventoryId ? [{ id: 'remove', label: 'Убрать из инвентаря', enabled: !equipped }] : []),
  ];
  for (const action of groups.find(group => group.id === item.groupId)?.actions ?? []) {
    let enabled = false;
    if (action === 'equip') enabled = primary && !equipped && !!item.equipSlot;
    if (action === 'unequip') enabled = equipped && state.items.filter(other => other.inventoryId === instance.inventoryId && !other.equippedSlot).length < (state.inventories.find(inventory => inventory.id === instance.inventoryId)?.capacity ?? 0);
    if (action === 'read') enabled = primary && !!item.grantedSkillId;
    if (action === 'split') enabled = !equipped && instance.quantity > 1;
    if (action === 'merge') enabled = !equipped && state.items.some(other => other.id !== instance.id && other.itemId === instance.itemId && other.inventoryId === instance.inventoryId && !other.equippedSlot && other.quantity + instance.quantity <= item.stackLimit);
    actions.push({ id: action, label: itemActionNames[action], enabled,
      ...(action === 'use-in-battle' ? { reason: 'Применяется в активном бою' } : action === 'unequip' && equipped && !enabled ? { reason: 'Освободите место в рюкзаке' } : {}),
    });
  }
  return actions;
}
