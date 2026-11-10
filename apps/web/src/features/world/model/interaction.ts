import { worldBlockReachable, type WorldInputFrame } from '@game/core';
import type { InventoryView, VoxelPosition, WorldExpeditionView } from '@game/core';
export const voxelKey = (p: VoxelPosition) => `${p.x}:${p.y}:${p.z}`;
export const sameVoxel = (a: VoxelPosition | null, b: VoxelPosition | null) => a === b || !!a && !!b && voxelKey(a) === voxelKey(b);
export function reachableBlock(origin: VoxelPosition, target: VoxelPosition, blockSizeMeters = .5) { return worldBlockReachable(origin, target, blockSizeMeters); }
export function directionFrames(view: WorldExpeditionView, x: number, z: number, jump = false, count = 2): WorldInputFrame[] {
  const sequence = view.location?.motion?.sequence ?? 0;
  return Array.from({ length: count }, (_, index) => ({ sequence: sequence + index + 1, x, z, jump: jump && index === 0 }));
}
export function worldTools(inventory: InventoryView | null, allowedToolClassIds?: string[]) {
  const primary = inventory?.inventories.find(entry => entry.primary);
  return inventory?.items.flatMap(item => {
    const definition = inventory.definitions.find(entry => entry.id === item.itemId);
    return definition?.toolClassId && (!allowedToolClassIds || allowedToolClassIds.includes(definition.toolClassId)) && item.inventoryId === primary?.id && !item.equippedSlot
      ? [{ id: item.id, name: definition.name, toolClassId: definition.toolClassId, reserved: item.actions.length > 0 && item.actions.every(action => !action.enabled && action.reason === 'Инструмент используется командой мира') }] : [];
  }) ?? [];
}
