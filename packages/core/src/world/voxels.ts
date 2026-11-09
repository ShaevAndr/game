import type { VoxelChunk, VoxelPosition, WorldRegion } from './types';

export const voxelIndex = (position: VoxelPosition, size: VoxelPosition) => (position.y * size.z + position.z) * size.x + position.x;
export const sameVoxel = (a: VoxelPosition, b: VoxelPosition) => a.x === b.x && a.y === b.y && a.z === b.z;
export const voxelDistance = (a: VoxelPosition, b: VoxelPosition) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
export const voxelNeighbors = (p: VoxelPosition): VoxelPosition[] => [
  { ...p, x: p.x - 1 }, { ...p, x: p.x + 1 }, { ...p, y: p.y - 1 }, { ...p, y: p.y + 1 }, { ...p, z: p.z - 1 }, { ...p, z: p.z + 1 },
];
export function insideRegion(region: Pick<WorldRegion, 'size'>, p: VoxelPosition): boolean {
  return [p.x, p.y, p.z].every(Number.isInteger) && p.x >= 0 && p.y >= 0 && p.z >= 0 && p.x < region.size.x && p.y < region.size.y && p.z < region.size.z;
}
function address(region: WorldRegion, p: VoxelPosition): { chunk: VoxelChunk; index: number } {
  if (!insideRegion(region, p)) throw new Error('Координаты за пределами участка');
  const s = region.chunkSize;
  const cx = Math.floor(p.x / s.x), cy = Math.floor(p.y / s.y), cz = Math.floor(p.z / s.z);
  const nx = Math.ceil(region.size.x / s.x), nz = Math.ceil(region.size.z / s.z);
  const chunk = region.chunks[(cy * nz + cz) * nx + cx];
  return { chunk, index: voxelIndex({ x: p.x % s.x, y: p.y % s.y, z: p.z % s.z }, chunk.size) };
}
export function worldBlockAt(region: WorldRegion, p: VoxelPosition): string | null {
  const { chunk, index } = address(region, p);
  return chunk.palette[chunk.blocks[index]];
}
/** Mutates a detached transition draft; callers must not pass the persisted input. */
export function writeWorldBlock(region: WorldRegion, p: VoxelPosition, blockId: string | null): void {
  const { chunk, index } = address(region, p);
  let paletteIndex = chunk.palette.indexOf(blockId);
  if (paletteIndex < 0) { paletteIndex = chunk.palette.length; chunk.palette.push(blockId); }
  chunk.blocks[index] = paletteIndex;
}
export function canStandInWorld(region: WorldRegion, p: VoxelPosition): boolean {
  const head = { ...p, y: p.y + 1 }, support = { ...p, y: p.y - 1 };
  return insideRegion(region, p) && insideRegion(region, head) && insideRegion(region, support)
    && worldBlockAt(region, p) === null && worldBlockAt(region, head) === null && worldBlockAt(region, support) !== null;
}
