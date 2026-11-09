import type { WorldCatalog, WorldSettings } from './types';

/** Small initial settings; dimensions belong to the world, never to the battle grid. */
export const defaultWorldSettings: WorldSettings = {
  mapWidth: 5, mapDepth: 5, regionSize: { x: 16, y: 16, z: 16 }, chunkSize: { x: 8, y: 8, z: 8 },
  blockSizeMeters: 1, minGroundHeight: 3, maxGroundHeight: 5, treeChanceBps: 800, cargoCapacity: 24,
};
export const initialWorldCatalog: WorldCatalog = {
  toolClasses: [
    { id: 'axe', name: 'Топор' }, { id: 'pickaxe', name: 'Кирка' },
    { id: 'shovel', name: 'Лопата' }, { id: 'sickle', name: 'Серп' }, { id: 'chisel', name: 'Зубило' },
  ],
  foundationBlockId: 'bedrock',
  blocks: [
    { id: 'bedrock', name: 'Неразрушимое основание', color: '#30343b' },
    { id: 'soil', name: 'Грунт', color: '#79533a', harvest: {
      resourceId: 'forest-soil', resourceType: 'mineral', level: 1, allowedToolClassIds: ['pickaxe', 'shovel'],
      drops: [{ itemId: 'peat', quantity: 1, chanceBps: 10000 }],
    } },
    { id: 'grass', name: 'Дёрн', color: '#598345', harvest: {
      resourceId: 'forest-turf', resourceType: 'mineral', level: 1, allowedToolClassIds: ['pickaxe', 'shovel'],
      drops: [{ itemId: 'peat', quantity: 1, chanceBps: 10000 }, { itemId: 'healing-herb', quantity: 1, chanceBps: 1000 }],
    } },
    { id: 'stone', name: 'Каменная порода', color: '#81858a', harvest: {
      resourceId: 'forest-stone', resourceType: 'mineral', level: 1, allowedToolClassIds: ['pickaxe'],
      drops: [{ itemId: 'flint', quantity: 1, chanceBps: 10000 }],
    } },
    { id: 'copper-vein', name: 'Медная порода', color: '#a57b56', harvest: {
      resourceId: 'forest-copper', resourceType: 'mineral', level: 1, allowedToolClassIds: ['pickaxe'],
      drops: [{ itemId: 'copper-ore', quantity: 1, chanceBps: 10000 }, { itemId: 'flint', quantity: 1, chanceBps: 2500 }],
    } },
    { id: 'oak-trunk', name: 'Дубовый ствол', color: '#775036', harvest: {
      resourceId: 'world-oak', resourceType: 'tree', level: 1, allowedToolClassIds: ['axe'],
      drops: [{ itemId: 'oak-wood', quantity: 2, chanceBps: 10000 }, { itemId: 'tree-resin', quantity: 1, chanceBps: 1000 }],
    } },
    { id: 'pine-trunk', name: 'Сосновый ствол', color: '#986c47', harvest: {
      resourceId: 'world-pine', resourceType: 'tree', level: 1, allowedToolClassIds: ['axe'],
      drops: [{ itemId: 'pine-wood', quantity: 2, chanceBps: 10000 }, { itemId: 'tree-resin', quantity: 1, chanceBps: 2500 }],
    } },
    { id: 'leaves', name: 'Листва', color: '#3e6b3d', harvest: {
      resourceId: 'world-leaves', resourceType: 'plant', level: 1, allowedToolClassIds: ['axe', 'sickle'],
      drops: [{ itemId: 'healing-herb', quantity: 1, chanceBps: 2500 }],
    } },
  ],
  biomes: [{
    id: 'forest', name: 'Шепчущий лес', weight: 1,
    surfaceBlockId: 'grass', soilBlockId: 'soil', stoneBlockId: 'stone',
    trees: [
      { trunkBlockId: 'oak-trunk', crownBlockId: 'leaves', height: 3 },
      { trunkBlockId: 'pine-trunk', crownBlockId: 'leaves', height: 4 },
    ],
    veins: [{ blockId: 'copper-vein', minDepth: 2, maxDepth: 5, chanceBps: 1200 }],
  }],
};
