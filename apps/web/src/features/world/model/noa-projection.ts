import { voxelIndex, voxelNeighbors, worldVoxel } from '@game/core';
import type { VoxelPosition, WorldView } from '@game/core';

/** Missing buried blocks stay solid. Water is rendered but can be traversed. */
export function projectWorldToNoa(region: NonNullable<WorldView['region']>, origin: VoxelPosition, previous?: Map<string, number>) {
  const types = new Map(previous);
  for (const block of region.palette) if (!types.has(block.id)) types.set(block.id, types.size + 2);
  const liquids = new Set(region.palette.filter(block => block.liquid).map(block => types.get(block.id)!));
  const { size } = region;
  const grid = new Uint16Array(size.x * size.y * size.z).fill(1);
  const seen = new Uint8Array(grid.length);
  const inside = ({ x, y, z }: VoxelPosition) => x >= 0 && y >= 0 && z >= 0 && x < size.x && y < size.y && z < size.z;
  for (const block of region.blocks) grid[voxelIndex(block.position, size)] = types.get(block.blockId)!;
  const start = worldVoxel(origin), startIndex = voxelIndex(start, size);
  if (!inside(start) || (grid[startIndex] > 1 && !liquids.has(grid[startIndex]))) throw new Error('Недопустимая позиция в мире');
  const queue: VoxelPosition[] = [];
  const visit = (p: VoxelPosition, index: number) => {
    seen[index] = 1;
    const id = grid[index];
    if (id !== 1 && !liquids.has(id)) return;
    if (id === 1) grid[index] = 0;
    queue.push(p);
  };
  visit(start, startIndex);
  for (let i = 0; i < queue.length; i++) for (const p of voxelNeighbors(queue[i])) {
    if (!inside(p)) continue;
    const index = voxelIndex(p, size);
    if (!seen[index]) visit(p, index);
  }
  const voxel = (p: VoxelPosition) => inside(p) ? grid[voxelIndex(p, size)] : 0;
  return { types, liquids, voxel, solid: (p: VoxelPosition) => {
    const id = voxel(p);
    return !inside(p) || (id !== 0 && !liquids.has(id));
  } };
}
