import type { InventoryView, VoxelPosition, WorldExpeditionView } from '@game/core';
export const voxelKey = (p: VoxelPosition) => `${p.x}:${p.y}:${p.z}`;
export const sameVoxel = (a: VoxelPosition | null, b: VoxelPosition | null) => a === b || !!a && !!b && voxelKey(a) === voxelKey(b);
export function reachableBlock(origin: VoxelPosition, target: VoxelPosition) {
  const distance = (y: number) => Math.abs(origin.x - target.x) + Math.abs(y - target.y) + Math.abs(origin.z - target.z);
  return distance(origin.y) === 1 || distance(origin.y + 1) === 1;
}
/** Suggest coordinates on an observed support. The server still verifies every collision and revision. */
export function stepTarget(view: WorldExpeditionView, dx: number, dz: number): VoxelPosition | null {
  const region = view.region, origin = view.location?.position;
  if (!region || !origin || Math.abs(dx) + Math.abs(dz) !== 1) return null;
  const blocks = new Set(region.blocks.map(block => voxelKey(block.position)));
  for (const dy of [0, 1, -1]) {
    const p = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
    if (p.x < 0 || p.z < 0 || p.x >= region.size.x || p.z >= region.size.z || p.y < 1 || p.y + 1 >= region.size.y) continue;
    if (blocks.has(voxelKey({ ...p, y: p.y - 1 })) && !blocks.has(voxelKey(p)) && !blocks.has(voxelKey({ ...p, y: p.y + 1 }))) return p;
  }
  return null;
}
export function worldTools(inventory: InventoryView | null) {
  const primary = inventory?.inventories.find(entry => entry.primary);
  return inventory?.items.flatMap(item => {
    const definition = inventory.definitions.find(entry => entry.id === item.itemId);
    return definition?.toolClassId && item.inventoryId === primary?.id && !item.equippedSlot
      ? [{ id: item.id, name: definition.name, toolClassId: definition.toolClassId, reserved: item.actions.length > 0 && item.actions.every(action => !action.enabled && action.reason === 'Инструмент используется командой мира') }] : [];
  }) ?? [];
}
