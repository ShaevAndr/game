import type { WorldCatalog, WorldSettings } from './types';

export const defaultWorldSettings: WorldSettings = {
  mapWidth: 5, mapDepth: 5, regionSize: { x: 48, y: 28, z: 48 }, chunkSize: { x: 8, y: 8, z: 8 },
  blockSizeMeters: .5, minGroundHeight: 4, maxGroundHeight: 20, treeChanceBps: 800, cargoCapacity: 24,
};
export const initialWorldCatalog: WorldCatalog = {
  toolClasses: [
    { id: 'axe', name: 'Топор' }, { id: 'pickaxe', name: 'Кирка' },
    { id: 'shovel', name: 'Лопата' }, { id: 'sickle', name: 'Серп' }, { id: 'chisel', name: 'Зубило' },
  ],
  foundationBlockId: 'bedrock',
  blocks: [
    { id: 'masonry', name: 'Каменная кладка', color: '#9a9993', harvest: {
      resourceId: 'world-masonry', resourceType: 'mineral', level: 1, allowedToolClassIds: ['pickaxe'],
      drops: [{ itemId: 'flint', quantity: 2, chanceBps: 10000 }],
    } },
    { id: 'planks', name: 'Деревянный блок', color: '#bc945e', harvest: {
      resourceId: 'world-planks', resourceType: 'tree', level: 1, allowedToolClassIds: ['axe'],
      drops: [{ itemId: 'oak-wood', quantity: 4, chanceBps: 10000 }],
    } },
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
    { id: 'water', name: 'Пресная вода', color: '#329dc4', liquid: true },
    { id: 'sand', name: 'Прибрежный песок', color: '#d5bd82', maxHp: 40, harvest: {
      resourceId: 'world-sand', resourceType: 'mineral', level: 1, allowedToolClassIds: ['shovel', 'pickaxe'],
      drops: [{ itemId: 'river-sand', quantity: 1, chanceBps: 10000 }],
    } },
    { id: 'clay', name: 'Береговая глина', color: '#a96d53', maxHp: 50, harvest: {
      resourceId: 'world-clay', resourceType: 'mineral', level: 1, allowedToolClassIds: ['shovel', 'pickaxe'],
      drops: [{ itemId: 'river-clay', quantity: 1, chanceBps: 10000 }],
    } },
    { id: 'granite', name: 'Гранит', color: '#696d80', maxHp: 130, harvest: {
      resourceId: 'world-granite', resourceType: 'mineral', level: 1, allowedToolClassIds: ['pickaxe'],
      drops: [{ itemId: 'flint', quantity: 2, chanceBps: 10000 }],
    } },
    { id: 'scree', name: 'Каменистая осыпь', color: '#9b917f', maxHp: 55, harvest: {
      resourceId: 'world-scree', resourceType: 'mineral', level: 1, allowedToolClassIds: ['shovel', 'pickaxe'],
      drops: [{ itemId: 'flint', quantity: 1, chanceBps: 10000 }],
    } },
    { id: 'snow', name: 'Горный снег', color: '#e4edf0', maxHp: 25, harvest: {
      resourceId: 'world-snow', resourceType: 'mineral', level: 1, allowedToolClassIds: ['shovel', 'pickaxe'],
      drops: [{ itemId: 'snow-chunk', quantity: 1, chanceBps: 10000 }],
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
    relief: {
      waterBlockId: 'water', sandBlockId: 'sand', clayBlockId: 'clay',
      graniteBlockId: 'granite', snowBlockId: 'snow', screeBlockId: 'scree',
    },
  }],
};
