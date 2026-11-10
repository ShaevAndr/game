import { z } from 'zod';
import type { ItemDefinition } from '../items';
import type { WorldCatalog, WorldSettings } from './types';

const contentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const positive = z.number().int().positive();
const bps = z.number().int().min(0).max(10000);
const dimensions = z.object({ x: positive.max(64), y: positive.max(64), z: positive.max(64) }).strict();
export const voxelPositionSchema = z.object({
  x: z.number().int().min(0).max(63), y: z.number().int().min(0).max(63), z: z.number().int().min(0).max(63),
}).strict();
export const worldSettingsSchema = z.object({
  mapWidth: positive.max(16), mapDepth: positive.max(16),
  regionSize: dimensions, chunkSize: dimensions,
  blockSizeMeters: z.number().finite().min(0.1).max(10),
  minGroundHeight: positive, maxGroundHeight: positive,
  treeChanceBps: bps, cargoCapacity: positive.max(10000),
}).strict().superRefine((settings, ctx) => {
  const { regionSize: size, chunkSize: chunk } = settings;
  if (size.x < 5 || size.z < 5 || size.y < 8 || size.x * size.y * size.z > 65536)
    ctx.addIssue({ code: 'custom', message: 'Участок должен вмещать точку входа и не более 65536 блоков' });
  if (chunk.x > size.x || chunk.y > size.y || chunk.z > size.z)
    ctx.addIssue({ code: 'custom', message: 'Чанк превышает размеры участка' });
  if (settings.minGroundHeight < 2 || settings.maxGroundHeight < settings.minGroundHeight || settings.maxGroundHeight > size.y - 3)
    ctx.addIssue({ code: 'custom', message: 'Некорректная высота грунта' });
});
const harvestSchema = z.object({
  resourceId: contentId, resourceType: z.enum(['plant', 'tree', 'mineral', 'crystal']), level: positive.max(100),
  allowedToolClassIds: z.array(contentId).min(1).max(32),
  drops: z.array(z.object({ itemId: contentId, quantity: positive.max(10000), chanceBps: bps }).strict()).min(1).max(32),
}).strict();
export const worldCatalogSchema = z.object({
  toolClasses: z.array(z.object({ id: contentId, name: z.string().min(1).max(80) }).strict()).min(1).max(64),
  foundationBlockId: contentId,
  blocks: z.array(z.object({
    id: contentId, name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), maxHp: positive.max(1000000).optional(), harvest: harvestSchema.optional(),
  }).strict()).min(1).max(256),
  biomes: z.array(z.object({
    id: contentId, name: z.string().min(1).max(80), weight: positive.max(10000),
    surfaceBlockId: contentId, soilBlockId: contentId, stoneBlockId: contentId,
    trees: z.array(z.object({ trunkBlockId: contentId, crownBlockId: contentId, height: positive.max(8) }).strict()).max(32),
    veins: z.array(z.object({ blockId: contentId, minDepth: positive.max(64), maxDepth: positive.max(64), chanceBps: bps }).strict()).max(32),
  }).strict()).min(1).max(64),
}).strict();

export const worldInputFrameSchema = z.object({ sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), x: z.number().finite().min(-1).max(1), z: z.number().finite().min(-1).max(1), jump: z.boolean() }).strict();
export const worldActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('travel'), cellId: z.string().regex(/^\d{1,2}:\d{1,2}$/) }).strict(),
  z.object({ type: z.literal('enter') }).strict(),
  z.object({ type: z.literal('leave') }).strict(),
  z.object({ type: z.literal('move'), frames: z.array(worldInputFrameSchema).min(1).max(4) }).strict(),
  z.object({ type: z.literal('harvest'), position: voxelPositionSchema, toolInstanceId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('build'), position: voxelPositionSchema, recipeId: contentId }).strict(),
  z.object({ type: z.literal('collect') }).strict(),
  z.object({ type: z.literal('close') }).strict(),
]);
export type WorldAction = z.infer<typeof worldActionSchema>;
export const worldCommandSchema = z.object({
  operationId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), action: worldActionSchema,
}).strict();
export type WorldCommand = z.infer<typeof worldCommandSchema>;

/** Returns a detached, validated content snapshot for the expedition. */
export function validateWorldCatalog(input: WorldCatalog, settingsInput: WorldSettings, items: ItemDefinition[]): WorldCatalog {
  const catalog = worldCatalogSchema.parse(input);
  const settings = worldSettingsSchema.parse(settingsInput);
  const fail = (message: string): never => { throw new Error(`Некорректный каталог мира: ${message}`); };
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(catalog.blocks.map(block => block.id)) || !unique(catalog.biomes.map(biome => biome.id)) || !unique(catalog.toolClasses.map(tool => tool.id))) fail('повтор ID');
  const blockIds = new Set(catalog.blocks.map(block => block.id));
  const toolIds = new Set(catalog.toolClasses.map(tool => tool.id));
  const foundation = catalog.blocks.find(block => block.id === catalog.foundationBlockId);
  if (!foundation || foundation.harvest) fail('основание должно быть неразрушаемым');
  for (const item of items) if (item.toolClassId && !toolIds.has(item.toolClassId)) fail(`неизвестный класс ${item.toolClassId}`);
  for (const block of catalog.blocks) {
    const harvest = block.harvest;
    if (!harvest) continue;
    if (!unique(harvest.allowedToolClassIds) || harvest.allowedToolClassIds.some(id => !toolIds.has(id))) fail(`классы инструмента ${block.id}`);
    if (harvest.drops.some(drop => !items.some(item => item.id === drop.itemId && !item.equipSlot && !item.effects?.length && !item.heal))) fail(`материалы ${block.id}`);
    if (harvest.drops.filter(drop => drop.chanceBps > 0).reduce((sum, drop) => sum + drop.quantity, 0) > settings.cargoCapacity) fail(`выход превышает груз ${block.id}`);
  }
  for (const biome of catalog.biomes) {
    const references = [biome.surfaceBlockId, biome.soilBlockId, biome.stoneBlockId, ...biome.trees.flatMap(tree => [tree.trunkBlockId, tree.crownBlockId]), ...biome.veins.map(vein => vein.blockId)];
    if (references.some(id => !blockIds.has(id))) fail(`блоки биома ${biome.id}`);
    if (biome.trees.some(tree => settings.maxGroundHeight + tree.height + 2 >= settings.regionSize.y)) fail(`деревья не помещаются в ${biome.id}`);
    if (biome.veins.some(vein => vein.minDepth > vein.maxDepth)) fail(`глубина жил ${biome.id}`);
  }
  return catalog;
}
