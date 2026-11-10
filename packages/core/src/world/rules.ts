import { applyWorldMovement, createWorldMotion, findWorldEntry, worldRegionSolid, worldBodyCollides, worldBodyIntersects, worldBodyGrounded, worldBlockVisible, worldSpawnPosition } from './movement';
import { validateWorldBuildPermit } from './building';
import type { ItemDefinition } from '../items';
import { gatheringLevel } from '../gathering/rules';
import { runGatheringMinigame, type GatheringMinigameContext } from '../gathering/minigame';
import { validateWorldCatalog, worldCommandSchema, worldSettingsSchema, type WorldCommand } from './config';
import { generateWorldMap, generateWorldRegion } from './generation';
import { nextWorldRandom, worldSeed } from './random';
import { canStandInWorld, insideRegion, sameVoxel, voxelNeighbors, voxelDistance, worldBlockAt, worldBlockHealth, writeWorldBlock } from './voxels';
import type { VoxelWorld, WorldActor, WorldCatalog, WorldGatherer, WorldOutcome, WorldSettings, WorldTool, WorldBuildPermit } from './types';

export function createVoxelWorld(input: {
  id: string; partyId: string; seed: number; catalog: WorldCatalog; settings: WorldSettings; items: ItemDefinition[];
  /** Load the participants' persistent gathering XP before creating the expedition. */
  gatherers?: Omit<WorldGatherer, 'cargo'>[];
}): VoxelWorld {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) throw new Error('Некорректное зерно мира');
  if (!input.id || !input.partyId) throw new Error('Нужны ID мира и группы');
  const settings = worldSettingsSchema.parse(input.settings);
  const catalog = validateWorldCatalog(input.catalog, settings, input.items);
  const gatherers = input.gatherers ?? [];
  if (new Set(gatherers.map(entry => entry.characterId)).size !== gatherers.length
    || gatherers.some(entry => !Number.isSafeInteger(entry.xp) || entry.xp < 0 || !entry.playerId || !entry.characterId)) throw new Error('Некорректный прогресс собирателей');
  return {
    id: input.id, partyId: input.partyId, seed: input.seed, generatorRevision: 1,
    rngState: worldSeed(input.seed, `loot:${input.id}`), revision: 0, status: 'active', settings, catalog,
    map: generateWorldMap(input.seed, catalog, settings), regions: [],
    location: { cellId: `${Math.floor(settings.mapWidth / 2)}:${Math.floor(settings.mapDepth / 2)}`, position: null },
    gatherers: gatherers.map(entry => ({ ...entry, cargo: [] })),
  };
}

/** Pure command transition. The application must check current authorization and replay
 * receipts before calling this, then commit state, XP, receipt and manifests atomically.
 */
export function applyWorldCommand(input: VoxelWorld, rawCommand: WorldCommand, actor: WorldActor, tool?: WorldTool,
  minigame: (context: GatheringMinigameContext) => boolean = runGatheringMinigame, build?: WorldBuildPermit, movement?: { usedAt: number },
): { state: VoxelWorld; outcome: WorldOutcome } {
  const command = worldCommandSchema.parse(rawCommand);
  if (actor.partyId !== input.partyId || !actor.playerId || !actor.characterId || !actor.membershipId) throw new Error('Нет доступа к миру группы');
  if (input.status !== 'active' || !input.location) throw new Error('Экспедиция закрыта');
  if (input.generatorRevision !== 1) throw new Error('Неизвестная ревизия генератора');
  if (command.expectedRevision !== input.revision) throw new Error('Конфликт ревизии мира');
  if (input.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Исчерпана ревизия мира');
  const { action } = command;
  if (action.type !== 'harvest' && action.type !== 'build' && action.type !== 'collect' && !actor.isLeader) throw new Error('Перемещением и завершением экспедиции управляет лидер');
  const state = structuredClone(input);
  const location = state.location!;
  const outcome: WorldOutcome = { type: action.type, success: true, loot: [], xpGained: 0, rolls: [], manifests: [] };
  if (action.type === 'collect') {
    const gatherer = state.gatherers.find(entry => entry.characterId === actor.characterId && entry.playerId === actor.playerId);
    if (!gatherer) throw new Error('Прогресс собирателя не загружен');
    if (gatherer.cargo.length) {
      outcome.manifests = [{ id: `${state.id}:${actor.characterId}:${state.revision + 1}`, worldId: state.id,
        playerId: actor.playerId, characterId: actor.characterId, cargo: structuredClone(gatherer.cargo) }];
      gatherer.cargo = [];
    }
  } else if (action.type === 'close') {
    outcome.manifests = state.gatherers.filter(entry => entry.cargo.length).map(entry => ({
      id: `${state.id}:${entry.characterId}:${state.revision + 1}`, worldId: state.id, playerId: entry.playerId,
      characterId: entry.characterId, cargo: structuredClone(entry.cargo),
    }));
    for (const entry of state.gatherers) entry.cargo = [];
    state.map = []; state.regions = []; state.location = null; state.status = 'closed';
  } else if (action.type === 'travel') {
    if (location.position) throw new Error('Сначала выйдите на макрокарту');
    const current = state.map.find(cell => cell.id === location.cellId)!;
    const target = state.map.find(cell => cell.id === action.cellId);
    if (!target || Math.abs(target.x - current.x) + Math.abs(target.z - current.z) !== 1) throw new Error('Можно перейти только в соседнюю клетку');
    location.cellId = target.id;
  } else if (action.type === 'enter') {
    if (location.position) throw new Error('Отряд уже находится на участке');
    let region = state.regions.find(entry => entry.cellId === location.cellId);
    if (!region) {
      region = generateWorldRegion(state.seed, state.map, location.cellId, state.catalog, state.settings);
      state.regions.push(region);
    }
    location.position = findWorldEntry(region, state.settings.blockSizeMeters);
    location.motion = createWorldMotion(location.position, worldRegionSolid(region), state.settings.blockSizeMeters);
  } else if (action.type === 'leave') {
    if (!location.position) throw new Error('Отряд уже находится на макрокарте');
    location.position = null; delete location.motion;
  } else {
    const position = location.position;
    const region = state.regions.find(entry => entry.cellId === location.cellId);
    if (!position || !region) throw new Error('Сначала войдите на участок');
    if (action.type === 'move') {
      if (!movement) throw new Error('Нужен серверный допуск движения');
      const next = applyWorldMovement(region, position, location.motion, action.frames, state.settings.blockSizeMeters, movement.usedAt);
      location.position = next.position; location.motion = next.motion;
    } else if (action.type === 'build') {
      const recipe = validateWorldBuildPermit(build, action.recipeId, actor.characterId), p = action.position;
      if (!insideRegion(region, p) || !worldBlockVisible(region, position, p, state.settings.blockSizeMeters)) throw new Error('Место строительства недостижимо');
      if (worldBlockAt(region, p) !== null || worldBodyIntersects(position, p, state.settings.blockSizeMeters)) throw new Error('Место строительства занято');
      if (worldBodyIntersects(worldSpawnPosition(region.spawn), p, state.settings.blockSizeMeters)) throw new Error('Нельзя перекрывать точку входа');
      if (!voxelNeighbors(p).some(next => insideRegion(region, next) && worldBlockAt(region, next) !== null)) throw new Error('Нужна опора для постройки');
      if (!state.catalog.blocks.some(block => block.id === recipe.blockId)) throw new Error('Постройка отсутствует в каталоге мира');
      writeWorldBlock(region, p, recipe.blockId); region.revision++;
    } else {
      if (!insideRegion(region, action.position)) throw new Error('Координаты за пределами участка');
      if (!worldBlockVisible(region, position, action.position, state.settings.blockSizeMeters))
        throw new Error('Блок недостижим: подойдите вплотную');
      const blockId = worldBlockAt(region, action.position);
      const block = state.catalog.blocks.find(entry => entry.id === blockId);
      if (!block?.harvest) throw new Error('Этот блок нельзя добыть');
      if (!tool || tool.instanceId !== action.toolInstanceId || tool.ownerCharacterId !== actor.characterId
        || !block.harvest.allowedToolClassIds.includes(tool.toolClassId) || !Number.isSafeInteger(tool.power) || tool.power < 1 || tool.power > 1000000
        || !Number.isSafeInteger(tool.usedAt) || tool.usedAt < 0) throw new Error('Нужен доступный инструмент подходящего класса');
      if (region.lastHitAt?.[actor.characterId] !== undefined && tool.usedAt - region.lastHitAt[actor.characterId] < 250) throw new Error('Слишком частые удары: дождитесь следующего удара');
      const gatherer = state.gatherers.find(entry => entry.characterId === actor.characterId);
      if (!gatherer) throw new Error('Прогресс собирателя не загружен');
      if (gatherer.playerId !== actor.playerId) throw new Error('Владелец груза не совпадает');
      if (gatheringLevel(gatherer.xp) < block.harvest.level) throw new Error(`Нужен уровень собирателя ${block.harvest.level}`);
      const maximumYield = block.harvest.drops.filter(drop => drop.chanceBps > 0).reduce((sum, drop) => sum + drop.quantity, 0);
      if (gatherer.cargo.reduce((sum, item) => sum + item.quantity, 0) + maximumYield > state.settings.cargoCapacity)
        throw new Error('Недостаточно места в грузе');
      if (gatherer.xp > Number.MAX_SAFE_INTEGER - block.harvest.level) throw new Error('Исчерпан опыт собирателя');
      outcome.success = minigame({ resourceId: block.harvest.resourceId, resourceType: block.harvest.resourceType,
        resourceLevel: block.harvest.level, methodId: tool.toolClassId });
      if (outcome.success) {
        const health = worldBlockHealth(region, action.position, block), hp = Math.max(0, health.hp - tool.power);
        (region.lastHitAt ??= {})[actor.characterId] = tool.usedAt;
        outcome.hit = { damage: health.hp - hp, hp, maxHp: health.maxHp, destroyed: hp === 0 };
        if (hp > 0) {
          (region.blockHealth ??= {})[`${action.position.x}:${action.position.y}:${action.position.z}`] = { hp, maxHp: health.maxHp };
          region.revision++; state.revision++;
          return { state, outcome };
        }
        for (const drop of block.harvest.drops) {
          const random = nextWorldRandom(state.rngState); state.rngState = random.state; outcome.rolls.push(random.bps);
          if (random.bps >= drop.chanceBps) continue;
          const loot = outcome.loot.find(entry => entry.itemId === drop.itemId);
          if (loot) loot.quantity += drop.quantity; else outcome.loot.push({ itemId: drop.itemId, quantity: drop.quantity });
        }
        for (const drop of outcome.loot) {
          const cargo = gatherer.cargo.find(entry => entry.itemId === drop.itemId);
          if (cargo) cargo.quantity += drop.quantity; else gatherer.cargo.push({ ...drop });
        }
        gatherer.xp += block.harvest.level; outcome.xpGained = block.harvest.level;
        writeWorldBlock(region, action.position, null); region.revision++;
        if (location.motion) location.motion.grounded = worldBodyGrounded(position, worldRegionSolid(region), state.settings.blockSizeMeters);
      }
    }
  }
  state.revision++;
  return { state, outcome };
}
