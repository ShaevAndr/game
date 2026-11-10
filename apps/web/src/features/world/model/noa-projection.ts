import { worldVoxel } from '@game/core';
import type { VoxelPosition, WorldView } from '@game/core';
import { voxelKey } from './interaction';
/** Only air connected to the authoritative position is traversable. Missing buried blocks stay solid. */
export function projectWorldToNoa(region: NonNullable<WorldView['region']>, origin: VoxelPosition, previous?: Map<string, number>) {
  const types = new Map(previous);
  for (const block of region.palette) if (!types.has(block.id)) types.set(block.id, types.size + 2);
  const solids = new Map(region.blocks.map(block => [voxelKey(block.position), types.get(block.blockId)!]));
  const inside = (p: VoxelPosition) => (['x', 'y', 'z'] as const).every(axis => Number.isInteger(p[axis]) && p[axis] >= 0 && p[axis] < region.size[axis]);
  const air = new Set<string>(), queue = [worldVoxel(origin)];
  if (!inside(queue[0]) || solids.has(voxelKey(queue[0]))) throw new Error('Недопустимая позиция в мире');
  air.add(voxelKey(queue[0]));
  for (let i = 0; i < queue.length; i++) for (const axis of ['x', 'y', 'z'] as const) for (const step of [-1, 1]) {
    const p = { ...queue[i], [axis]: queue[i][axis] + step }, key = voxelKey(p);
    if (inside(p) && !solids.has(key) && !air.has(key)) { air.add(key); queue.push(p); }
  }
  return { types, voxel: (p: VoxelPosition) => solids.get(voxelKey(p)) ?? (air.has(voxelKey(p)) ? 0 : 1) };
}
