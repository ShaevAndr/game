import { worldSettingsSchema } from './config';
import { worldSeed } from './random';
import { createWorldRelief } from './relief';
import { voxelIndex } from './voxels';
import type { VoxelChunk, VoxelPosition, WorldCatalog, WorldCell, WorldRegion, WorldSettings } from './types';

export function generateWorldMap(seed: number, catalog: WorldCatalog, input: WorldSettings): WorldCell[] {
  const settings = worldSettingsSchema.parse(input);
  const weight = catalog.biomes.reduce((sum, biome) => sum + biome.weight, 0);
  if (!Number.isSafeInteger(weight) || weight < 1) throw new Error('Нет биомов для генерации мира');
  const cells: WorldCell[] = [];
  for (let z = 0; z < settings.mapDepth; z++) for (let x = 0; x < settings.mapWidth; x++) {
    let roll = worldSeed(seed, `map:${x}:${z}`) % weight;
    const biome = catalog.biomes.find(entry => { roll -= entry.weight; return roll < 0; });
    if (!biome) throw new Error('Некорректные веса биомов');
    cells.push({ id: `${x}:${z}`, x, z, biomeId: biome.id });
  }
  return cells;
}

/** Generate once, persist the result. Entering an existing region must use its snapshot. */
export function generateWorldRegion(seed: number, map: WorldCell[], cellId: string, catalog: WorldCatalog, input: WorldSettings): WorldRegion {
  const settings = worldSettingsSchema.parse(input);
  const cell = map.find(entry => entry.id === cellId);
  const biome = catalog.biomes.find(entry => entry.id === cell?.biomeId);
  if (!cell || !biome) throw new Error('Клетка мира или биом не найдены');
  const neighborhood = map.filter(entry => Math.abs(entry.x - cell.x) + Math.abs(entry.z - cell.z) <= 1)
    .map(entry => `${entry.id}=${entry.biomeId}`).sort().join('|');
  const regionSeed = worldSeed(seed, `region:${cellId}:${neighborhood}`);
  const size = settings.regionSize;
  const dense: (string | null)[] = Array(size.x * size.y * size.z).fill(null);
  const heights = new Array<number>(size.x * size.z);
  const treeDensity = new Float32Array(size.x * size.z);
  const center = { x: Math.floor(size.x / 2), z: Math.floor(size.z / 2) };
  const heightAt = (x: number, z: number) => settings.minGroundHeight
    + worldSeed(regionSeed, `height:${x}:${z}`) % (settings.maxGroundHeight - settings.minGroundHeight + 1);
  const reliefAt = createWorldRelief(regionSeed, settings, biome);
  const spawnHeight = reliefAt?.(center.x, center.z).height ?? heightAt(center.x, center.z);
  const set = (p: VoxelPosition, block: string) => { dense[voxelIndex(p, size)] = block; };
  for (let z = 0; z < size.z; z++) for (let x = 0; x < size.x; x++) {
    const isSpawn = Math.abs(x - center.x) <= 1 && Math.abs(z - center.z) <= 1;
    const relief = isSpawn ? undefined : reliefAt?.(x, z);
    const height = isSpawn ? spawnHeight : relief?.height ?? heightAt(x, z);
    const column = z * size.x + x;
    heights[column] = height;
    treeDensity[column] = relief?.trees ?? 1;
    const surface = relief?.surface ?? biome.surfaceBlockId;
    const soil = relief?.soil ?? biome.soilBlockId;
    const stone = relief?.stone ?? biome.stoneBlockId;
    for (let y = 0; y < height; y++) {
      let block = y === 0 ? catalog.foundationBlockId : y === height - 1 ? surface : y === height - 2 ? soil : stone;
      if (y > 0 && y < height - 2) {
        // Each eligible entry has an independent roll; the first successful vein owns this block.
        const depth = height - 1 - y;
        const vein = biome.veins.find((entry, i) => depth >= entry.minDepth && depth <= entry.maxDepth
          && worldSeed(regionSeed, `vein:${x}:${y}:${z}:${i}`) % 10000 < entry.chanceBps);
        if (vein) block = vein.blockId;
      }
      set({ x, y, z }, block);
    }
    if (relief && biome.relief) for (let y = height; y < relief.waterLevel; y++) {
      set({ x, y, z }, biome.relief.waterBlockId);
    }
  }
  for (let z = 1; z < size.z - 1; z++) for (let x = 1; x < size.x - 1; x++) {
    if (!biome.trees.length || (Math.abs(x - center.x) <= 2 && Math.abs(z - center.z) <= 2)
      || worldSeed(regionSeed, `tree:${x}:${z}`) % 10000 >= settings.treeChanceBps * treeDensity[z * size.x + x]) continue;
    const tree = biome.trees[worldSeed(regionSeed, `species:${x}:${z}`) % biome.trees.length];
    const ground = heights[z * size.x + x];
    const crownY = ground + tree.height;
    const crown: VoxelPosition[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) crown.push({ x: x + dx, y: crownY, z: z + dz });
    if (reliefAt) {
      crown.push({ x, y: crownY + 1, z });
      if (tree.height <= 3) crown.push({ x: x - 1, y: crownY + 1, z }, { x: x + 1, y: crownY + 1, z },
        { x, y: crownY + 1, z: z - 1 }, { x, y: crownY + 1, z: z + 1 });
    }
    const trunk = Array.from({ length: tree.height }, (_, dy) => ({ x, y: ground + dy, z }));
    if ([...trunk, ...crown].some(p => p.y >= size.y || dense[voxelIndex(p, size)] !== null)) continue;
    for (const p of trunk) set(p, tree.trunkBlockId);
    for (const p of crown) set(p, tree.crownBlockId);
  }
  const chunkSize = settings.chunkSize;
  const chunks: VoxelChunk[] = [];
  for (let y = 0; y < size.y; y += chunkSize.y) for (let z = 0; z < size.z; z += chunkSize.z) for (let x = 0; x < size.x; x += chunkSize.x) {
    const chunk: VoxelChunk = {
      position: { x: x / chunkSize.x, y: y / chunkSize.y, z: z / chunkSize.z },
      size: { x: Math.min(chunkSize.x, size.x - x), y: Math.min(chunkSize.y, size.y - y), z: Math.min(chunkSize.z, size.z - z) },
      palette: [null], blocks: [],
    };
    for (let dy = 0; dy < chunk.size.y; dy++) for (let dz = 0; dz < chunk.size.z; dz++) for (let dx = 0; dx < chunk.size.x; dx++) {
      const block = dense[voxelIndex({ x: x + dx, y: y + dy, z: z + dz }, size)];
      let index = chunk.palette.indexOf(block);
      if (index < 0) { index = chunk.palette.length; chunk.palette.push(block); }
      chunk.blocks.push(index);
    }
    chunks.push(chunk);
  }
  return {
    cellId, seed: regionSeed, revision: 0, size: { ...size }, chunkSize: { ...chunkSize },
    spawn: { ...center, y: spawnHeight }, chunks,
    ...(reliefAt && biome.relief ? { liquidBlockIds: [biome.relief.waterBlockId] } : {}),
  };
}
