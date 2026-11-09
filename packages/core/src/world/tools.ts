import type { InventoryState } from '../inventory';
import type { ItemDefinition } from '../items';
import type { WorldTool } from './types';

/** Resolve from a canonical inventory snapshot, never from a client-provided class.
 * The application must keep this instance reserved until the world command settles.
 */
export function resolveWorldTool(inventory: InventoryState, instanceId: string, items: ItemDefinition[]): WorldTool {
  const primary = inventory.inventories.find(container => container.primary && container.ownerId === inventory.ownerId);
  const instance = inventory.items.find(item => item.id === instanceId);
  const definition = items.find(item => item.id === instance?.itemId);
  if (!primary || !instance || instance.ownerId !== inventory.ownerId || instance.inventoryId !== primary.id
    || instance.equippedSlot || !Number.isSafeInteger(instance.quantity) || instance.quantity < 1 || !definition?.toolClassId)
    throw new Error('Нужен доступный инструмент в основном рюкзаке');
  return { instanceId, ownerCharacterId: inventory.ownerId, toolClassId: definition.toolClassId };
}
