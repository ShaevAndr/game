import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWorldCommand, canStandInWorld, createVoxelWorld, defaultWorldSettings, generateWorldMap,
  generateWorldRegion, initialWorldCatalog, itemDefinitionSchema, seedContent, validateWorldCatalog,
  resolveWorldTool, worldBlockAt, worldCommandSchema, worldSettingsSchema, worldView, writeWorldBlock,
  type InventoryState, type ItemDefinition, type VoxelPosition, type VoxelWorld, type WorldAction, type WorldActor, type WorldTool,
} from '../src';

const actor: WorldActor = { playerId: 'player', characterId: 'hero', partyId: 'party', membershipId: 'membership', isLeader: true };
const member: WorldActor = { ...actor, playerId: 'other-player', characterId: 'other-hero', membershipId: 'other-membership', isLeader: false };
const operationId = '00000000-0000-4000-8000-000000000001';
const toolId = '00000000-0000-4000-8000-000000000002';
const axe: WorldTool = { instanceId: toolId, ownerCharacterId: actor.characterId, toolClassId: 'axe' };
const shovel: WorldTool = { ...axe, toolClassId: 'shovel' };
const pickaxe: WorldTool = { ...axe, toolClassId: 'pickaxe' };
const settings = () => ({ ...structuredClone(defaultWorldSettings), minGroundHeight: 5, maxGroundHeight: 5, treeChanceBps: 0 });
const gatherers = () => [actor, member].map(who => ({ playerId: who.playerId, characterId: who.characterId, xp: 0 }));
const create = (seed = 31415) => createVoxelWorld({ id: 'world', partyId: actor.partyId, seed, catalog: initialWorldCatalog, settings: settings(), items: seedContent.items, gatherers: gatherers() });
const command = (state: VoxelWorld, action: WorldAction, who = actor, tool?: WorldTool) =>
  applyWorldCommand(state, { operationId, expectedRevision: state.revision, action }, who, tool);
const enter = () => command(create(), { type: 'enter' }).state;
const floor = (state: VoxelWorld): VoxelPosition => ({ ...state.location!.position!, y: state.location!.position!.y - 1 });
const harvest = (state: VoxelWorld, position: VoxelPosition, tool: WorldTool, who = actor) =>
  command(state, { type: 'harvest', position, toolInstanceId: tool.instanceId }, who, tool);
const currentRegion = (state: VoxelWorld) => state.regions.find(region => region.cellId === state.location!.cellId)!;

test('world catalog validates references, drops, classes, foundation and generation budgets', () => {
  validateWorldCatalog(initialWorldCatalog, defaultWorldSettings, seedContent.items);
  for (const alter of [
    (catalog: typeof initialWorldCatalog) => { catalog.blocks.push(structuredClone(catalog.blocks[0])); },
    (catalog: typeof initialWorldCatalog) => { catalog.biomes[0].surfaceBlockId = 'missing'; },
    (catalog: typeof initialWorldCatalog) => { catalog.blocks[1].harvest!.allowedToolClassIds = ['missing']; },
    (catalog: typeof initialWorldCatalog) => { catalog.blocks[1].harvest!.drops[0].itemId = 'missing'; },
    (catalog: typeof initialWorldCatalog) => { catalog.blocks[1].harvest!.drops[0].chanceBps = 10001; },
    (catalog: typeof initialWorldCatalog) => { catalog.blocks[1].harvest!.drops[0].quantity = 25; },
    (catalog: typeof initialWorldCatalog) => { catalog.foundationBlockId = 'soil'; },
    (catalog: typeof initialWorldCatalog) => { catalog.biomes[0].trees[0].height = 8; },
    (catalog: typeof initialWorldCatalog) => { catalog.biomes[0].veins[0].minDepth = 6; },
  ]) {
    const catalog = structuredClone(initialWorldCatalog); alter(catalog);
    assert.throws(() => validateWorldCatalog(catalog, { ...defaultWorldSettings, regionSize: { x: 16, y: 12, z: 16 } }, seedContent.items));
  }
  assert.equal(worldSettingsSchema.safeParse({ ...defaultWorldSettings, regionSize: { x: 64, y: 64, z: 64 } }).success, false);
  assert.equal(worldSettingsSchema.safeParse({ ...defaultWorldSettings, minGroundHeight: 0 }).success, false);
  assert.equal(worldSettingsSchema.safeParse({ ...defaultWorldSettings, chunkSize: { x: 32, y: 8, z: 8 } }).success, false);
  assert.throws(() => createVoxelWorld({ ...create(), seed: -1, items: seedContent.items }));
});

test('item class is preserved by content parsing and is independent of the inventory group', () => {
  const item = itemDefinitionSchema.parse({ ...seedContent.items.find(item => item.id === 'woodcutting-axe')!, groupId: 'custom-tools' });
  assert.equal(item.toolClassId, 'axe'); assert.equal(item.groupId, 'custom-tools');
  assert.equal(itemDefinitionSchema.safeParse({ ...item, toolClassId: 'invalid class' }).success, false);
  assert.throws(() => validateWorldCatalog(initialWorldCatalog, defaultWorldSettings, [{ ...item, toolClassId: 'unknown' }]));
});

test('tool class comes from the owned backpack instance and unavailable tools are rejected', () => {
  const inventory: InventoryState = { ownerId: actor.characterId,
    inventories: [{ id: 'bag', ownerId: actor.characterId, name: 'Рюкзак', primary: true, capacity: 50 }],
    items: [{ id: toolId, itemId: 'woodcutting-axe', ownerId: actor.characterId, inventoryId: 'bag', quantity: 1, equippedSlot: null }],
  };
  assert.deepEqual(resolveWorldTool(inventory, toolId, seedContent.items), axe);
  for (const changes of [{ ownerId: 'stranger' }, { inventoryId: null }, { equippedSlot: 'main-hand' }, { quantity: 0 }, { itemId: 'oak-wood' }]) {
    const unavailable = structuredClone(inventory); Object.assign(unavailable.items[0], changes);
    assert.throws(() => resolveWorldTool(unavailable, toolId, seedContent.items), /инструмент/);
  }
  assert.throws(() => resolveWorldTool(inventory, 'missing', seedContent.items), /инструмент/);
});

test('generation is deterministic, detached from content edits and independent of visit order', () => {
  const world = create(); const before = structuredClone(world);
  const a = generateWorldRegion(world.seed, world.map, '0:0', world.catalog, world.settings);
  generateWorldRegion(world.seed, world.map, '1:0', world.catalog, world.settings);
  assert.deepEqual(generateWorldRegion(world.seed, [...world.map].reverse(), '0:0', world.catalog, world.settings), a);
  assert.notDeepEqual(generateWorldRegion(world.seed + 1, world.map, '0:0', world.catalog, world.settings).chunks, a.chunks);
  assert.deepEqual(world, before);
  const catalog = structuredClone(initialWorldCatalog), config = settings();
  const detached = createVoxelWorld({ id: 'world', partyId: 'party', seed: 10, catalog, settings: config, items: seedContent.items });
  catalog.blocks[1].color = '#000000'; config.regionSize.x = 64;
  assert.notEqual(detached.catalog.blocks[1].color, '#000000'); assert.equal(detached.settings.regionSize.x, 16);
});

test('macro generation uses biome weights and region seed includes surrounding environments', () => {
  const catalog = structuredClone(initialWorldCatalog);
  catalog.biomes.push({ ...structuredClone(catalog.biomes[0]), id: 'other-forest', name: 'Другой лес', weight: 3 });
  const map = generateWorldMap(1, catalog, defaultWorldSettings);
  assert.ok(map.some(cell => cell.biomeId === 'forest')); assert.ok(map.some(cell => cell.biomeId === 'other-forest'));
  const world = create(), region = generateWorldRegion(world.seed, world.map, '2:2', world.catalog, world.settings);
  const changedMap = structuredClone(world.map); changedMap.find(cell => cell.id === '2:1')!.biomeId = 'other-forest';
  assert.notEqual(generateWorldRegion(world.seed, changedMap, '2:2', catalog, world.settings).seed, region.seed);
});

test('chunks cover configurable dimensions including partial edge chunks without coordinate aliasing', () => {
  const config = { ...settings(), regionSize: { x: 13, y: 17, z: 11 }, chunkSize: { x: 5, y: 6, z: 4 } };
  const world = createVoxelWorld({ id: 'world', partyId: 'party', seed: 11, catalog: initialWorldCatalog, settings: config, items: seedContent.items });
  const region = command(world, { type: 'enter' }).state.regions[0];
  assert.equal(region.chunks.reduce((sum, chunk) => sum + chunk.blocks.length, 0), 13 * 17 * 11);
  assert.ok(canStandInWorld(region, region.spawn));
  for (const chunk of region.chunks) {
    const p = { x: chunk.position.x * config.chunkSize.x, y: chunk.position.y * config.chunkSize.y, z: chunk.position.z * config.chunkSize.z };
    writeWorldBlock(region, p, `marker-${p.x}-${p.y}-${p.z}`);
  }
  for (const chunk of region.chunks) {
    const p = { x: chunk.position.x * config.chunkSize.x, y: chunk.position.y * config.chunkSize.y, z: chunk.position.z * config.chunkSize.z };
    assert.equal(worldBlockAt(region, p), `marker-${p.x}-${p.y}-${p.z}`);
  }
  assert.throws(() => worldBlockAt(region, { x: 13, y: 1, z: 1 }), /пределами/);
  assert.throws(() => worldBlockAt(region, { x: 1.5, y: 1, z: 1 }), /пределами/);
});

test('forest generation leaves safe entry points and produces both tree species with buried veins', () => {
  const encountered = new Set<string>();
  for (let seed = 0; seed < 12; seed++) {
    const world = createVoxelWorld({ id: 'world', partyId: 'party', seed, catalog: initialWorldCatalog, settings: defaultWorldSettings, items: seedContent.items });
    const region = command(world, { type: 'enter' }).state.regions[0];
    assert.ok(canStandInWorld(region, region.spawn));
    for (const chunk of region.chunks) for (const block of chunk.palette) if (block) encountered.add(block);
    for (let z = 0; z < region.size.z; z++) for (let x = 0; x < region.size.x; x++) assert.equal(worldBlockAt(region, { x, y: 0, z }), 'bedrock');
  }
  assert.ok(encountered.has('oak-trunk')); assert.ok(encountered.has('pine-trunk')); assert.ok(encountered.has('copper-vein'));
});

test('only current leader moves the whole party and a foreign party cannot read or act', () => {
  const world = create();
  for (const action of [{ type: 'enter' }, { type: 'travel', cellId: '2:1' }, { type: 'close' }] as WorldAction[])
    assert.throws(() => command(world, action, member), /лидер/);
  assert.throws(() => command(world, { type: 'enter' }, { ...actor, partyId: 'foreign' }), /доступа/);
  assert.throws(() => worldView(world, { ...actor, partyId: 'foreign' }), /доступа/);
  assert.throws(() => command(world, { type: 'travel', cellId: '0:0' }), /соседнюю/);
  const traveled = command(world, { type: 'travel', cellId: '2:1' }).state;
  const inside = command(traveled, { type: 'enter' }).state;
  assert.deepEqual(worldView(inside, actor).location, worldView(inside, member).location);
  assert.throws(() => command(inside, { type: 'travel', cellId: '2:2' }), /макрокарту/);
  // Leadership comes from the application, so transfer does not generate another world.
  const moved = command(inside, { type: 'move', position: { ...inside.location!.position!, x: inside.location!.position!.x + 1 } }, { ...member, isLeader: true }).state;
  assert.equal(moved.id, world.id); assert.equal(moved.regions.length, 1);
});

test('movement rejects teleporting, diagonals, unsupported destinations, collisions and member commands', () => {
  const world = enter(), p = world.location!.position!;
  for (const target of [{ ...p, x: p.x + 2 }, { ...p, x: p.x + 1, z: p.z + 1 }, { ...p, x: p.x + 1, y: p.y + 1 }])
    assert.throws(() => command(world, { type: 'move', position: target }), /проходимый/);
  assert.throws(() => command(world, { type: 'move', position: { ...p, x: p.x + 1 } }, member), /лидер/);
  const obstructed = structuredClone(world); writeWorldBlock(currentRegion(obstructed), { ...p, x: p.x + 1, y: p.y + 1 }, 'leaves');
  assert.throws(() => command(obstructed, { type: 'move', position: { ...p, x: p.x + 1 } }), /проходимый/);
  assert.deepEqual(world.location!.position, p);
});

test('two distinct axes harvest two distinct trees by class, and only the acting member receives cargo', () => {
  const axes: ItemDefinition[] = [seedContent.items.find(item => item.id === 'woodcutting-axe')!,
    { id: 'another-axe', name: 'Другой топор', description: '', groupId: 'tools', stackLimit: 1, toolClassId: 'axe' }];
  for (const item of axes) for (const [blockId, material] of [['oak-trunk', 'oak-wood'], ['pine-trunk', 'pine-wood']]) {
    const world = enter(), p = { ...world.location!.position!, x: world.location!.position!.x + 1 };
    writeWorldBlock(currentRegion(world), p, blockId);
    const instanceId = item.id === 'woodcutting-axe' ? toolId : '00000000-0000-4000-8000-000000000003';
    const inventory: InventoryState = { ownerId: member.characterId,
      inventories: [{ id: 'bag', ownerId: member.characterId, name: 'Рюкзак', primary: true, capacity: 50 }],
      items: [{ id: instanceId, ownerId: member.characterId, inventoryId: 'bag', itemId: item.id, quantity: 1, equippedSlot: null }],
    };
    const result = harvest(world, p, resolveWorldTool(inventory, instanceId, axes), member);
    assert.ok(result.outcome.loot.some(loot => loot.itemId === material && loot.quantity === 2));
    assert.equal(worldView(result.state, actor).cargo.length, 0);
    assert.deepEqual(worldView(result.state, member).cargo, result.outcome.loot);
    assert.equal(worldBlockAt(currentRegion(result.state), p), null);
    assert.equal(worldBlockAt(currentRegion(world), p), blockId);
  }
});

test('starter axes clear trees and pickaxes excavate terrain without crossing tool classes', () => {
  for (const [tool, blockIds, wrongTool] of [
    [pickaxe, ['soil', 'grass', 'stone', 'copper-vein'], axe],
    [axe, ['oak-trunk', 'pine-trunk', 'leaves'], pickaxe],
  ] as const) for (const blockId of blockIds) {
    const world = enter(), position = floor(world);
    writeWorldBlock(currentRegion(world), position, blockId);
    assert.throws(() => harvest(world, position, wrongTool), /инструмент/);
    const result = harvest(world, position, tool);
    assert.equal(result.outcome.success, true);
    assert.equal(worldBlockAt(currentRegion(result.state), position), null);
    assert.equal(result.outcome.xpGained, 1);
  }
});

test('tool ownership, instance, class, distance, resource level and minigame are server inputs', () => {
  const world = enter(); const position = floor(world); const before = structuredClone(world);
  for (const tool of [axe, { ...shovel, ownerCharacterId: 'stranger' }, { ...shovel, instanceId: operationId }, undefined]) {
    assert.throws(() => applyWorldCommand(world, { operationId, expectedRevision: world.revision,
      action: { type: 'harvest', position, toolInstanceId: toolId } }, actor, tool, () => assert.fail('Blocked attempt ran minigame')), /инструмент/);
  }
  assert.throws(() => harvest(world, { ...position, x: position.x + 3 }, shovel), /недостижим/);
  const grass = world.catalog.blocks.find(block => block.id === 'grass')!;
  grass.harvest!.level = 2;
  assert.throws(() => harvest(world, position, shovel), /уровень собирателя 2/);
  grass.harvest!.level = 1;
  assert.deepEqual(world, before);
  const result = applyWorldCommand(world, { operationId, expectedRevision: world.revision,
    action: { type: 'harvest', position, toolInstanceId: toolId } }, actor, shovel, context => {
    assert.deepEqual(context, { resourceId: 'forest-turf', resourceType: 'mineral', resourceLevel: 1, methodId: 'shovel' }); return true;
  });
  assert.equal(result.outcome.xpGained, 1);
  assert.equal(worldCommandSchema.safeParse({ operationId, expectedRevision: 0, action: { type: 'harvest', position, toolInstanceId: toolId, success: true, toolClassId: 'shovel' } }).success, false);
});

test('independent drops can total above 100%, merge the same material and preserve server rolls', () => {
  const world = enter();
  world.catalog.blocks.find(block => block.id === 'grass')!.harvest!.drops = [
    { itemId: 'peat', quantity: 1, chanceBps: 10000 }, { itemId: 'peat', quantity: 2, chanceBps: 10000 },
    { itemId: 'tree-resin', quantity: 2, chanceBps: 0 },
  ];
  const result = harvest(world, floor(world), shovel);
  assert.deepEqual(result.outcome.loot, [{ itemId: 'peat', quantity: 3 }]);
  assert.equal(result.outcome.rolls.length, 3);
  assert.ok(result.outcome.rolls.every(roll => Number.isInteger(roll) && roll >= 0 && roll < 10000));
  assert.deepEqual(harvest(world, floor(world), shovel), result);
});

test('probabilistic bonuses sometimes drop and sometimes do not while the base yield stays guaranteed', () => {
  const base = enter(); let withBonus = 0;
  for (let sample = 0; sample < 40; sample++) {
    const world = structuredClone(base); world.rngState = sample * 10000000;
    const result = harvest(world, floor(world), shovel);
    assert.ok(result.outcome.loot.some(entry => entry.itemId === 'peat' && entry.quantity === 1));
    if (result.outcome.loot.some(entry => entry.itemId === 'healing-herb')) withBonus++;
  }
  assert.ok(withBonus > 0 && withBonus < 40);
});

test('persistent gathering XP is supplied explicitly and an unloaded participant cannot lose progress', () => {
  const unloaded = create(); unloaded.gatherers = [];
  const inside = command(unloaded, { type: 'enter' }).state;
  assert.throws(() => harvest(inside, floor(inside), shovel), /Прогресс собирателя не загружен/);
  const world = enter(); world.gatherers[0].xp = 10;
  world.catalog.blocks.find(block => block.id === 'grass')!.harvest!.level = 2;
  const result = harvest(world, floor(world), shovel);
  assert.equal(result.state.gatherers[0].xp, 12); assert.equal(result.outcome.xpGained, 2);
  const closed = command(result.state, { type: 'close' }).state;
  assert.equal(closed.gatherers[0].xp, 12);
});

test('empty independent drop result still exhausts the block once and awards gathering experience', () => {
  const world = enter();
  world.catalog.blocks.find(block => block.id === 'grass')!.harvest!.drops = [{ itemId: 'peat', quantity: 1, chanceBps: 0 }];
  const result = harvest(world, floor(world), shovel);
  assert.deepEqual(result.outcome.loot, []); assert.equal(result.outcome.xpGained, 1);
  assert.equal(worldBlockAt(currentRegion(result.state), floor(world)), null);
});

test('full cargo reserves possible bonuses before minigame and leaves the input completely intact', () => {
  const world = enter(); world.gatherers[0].cargo = [{ itemId: 'peat', quantity: 23 }];
  const before = structuredClone(world);
  assert.throws(() => applyWorldCommand(world, { operationId, expectedRevision: world.revision, action: { type: 'harvest', position: floor(world), toolInstanceId: toolId } },
    actor, shovel, () => assert.fail('Full cargo ran minigame')), /места в грузе/);
  assert.deepEqual(world, before);
});

test('failed minigame changes neither block, cargo, XP nor saved random stream', () => {
  const world = enter(); const result = applyWorldCommand(world,
    { operationId, expectedRevision: world.revision, action: { type: 'harvest', position: floor(world), toolInstanceId: toolId } }, actor, shovel, () => false);
  assert.equal(result.outcome.success, false); assert.deepEqual(result.outcome.rolls, []);
  assert.equal(result.state.rngState, world.rngState); assert.equal(result.state.gatherers[0].xp, 0);
  assert.deepEqual(result.state.regions, world.regions); assert.deepEqual(result.state.gatherers[0].cargo, []);
});

test('excavation moves the party down and revisiting loads the altered snapshot without regeneration', () => {
  const world = enter(), position = floor(world);
  const dug = harvest(world, position, shovel).state;
  assert.equal(dug.location!.position!.y, position.y);
  const left = command(dug, { type: 'leave' }).state;
  const away = command(left, { type: 'travel', cellId: '2:1' }).state;
  const neighbor = command(away, { type: 'enter' }).state;
  const back = command(command(command(neighbor, { type: 'leave' }).state, { type: 'travel', cellId: '2:2' }).state, { type: 'enter' }).state;
  assert.deepEqual(currentRegion(back), currentRegion(dug)); assert.equal(back.regions.length, 2);
  assert.equal(back.location!.position!.y, position.y); assert.deepEqual(back.gatherers, dug.gatherers);
});

test('stale revisions cannot harvest a shared block again and a spent block rejects a new operation', () => {
  const world = enter(), position = { ...world.location!.position!, x: world.location!.position!.x + 1 };
  writeWorldBlock(currentRegion(world), position, 'oak-trunk');
  const dug = harvest(world, position, axe).state;
  assert.throws(() => applyWorldCommand(dug, { operationId, expectedRevision: world.revision,
    action: { type: 'harvest', position, toolInstanceId: toolId } }, member, { ...axe, ownerCharacterId: member.characterId }), /Конфликт ревизии/);
  assert.throws(() => harvest(dug, position, axe), /нельзя добыть/);
  assert.equal(dug.gatherers.filter(entry => entry.cargo.length).length, 1); assert.equal(dug.gatherers[0].xp, 1);
});

test('JSON snapshot round trip preserves generation, loot RNG, cargo and further command results', () => {
  const world = harvest(enter(), floor(enter()), shovel).state;
  const restored = JSON.parse(JSON.stringify(world)) as VoxelWorld;
  assert.deepEqual(harvest(restored, floor(restored), shovel), harvest(world, floor(world), shovel));
  assert.deepEqual(worldView(restored, actor), worldView(world, actor));
});

test('view hides buried ore, sealed cavities, seeds, drop tables and internal chunk palettes', () => {
  let world = enter(); const p = world.location!.position!;
  const hidden = { ...p, y: 1 };
  writeWorldBlock(currentRegion(world), hidden, 'copper-vein');
  writeWorldBlock(currentRegion(world), { x: 1, y: 1, z: 1 }, null);
  writeWorldBlock(currentRegion(world), { x: 2, y: 1, z: 1 }, 'copper-vein');
  const view = worldView(world, actor);
  assert.equal(view.region!.blocks.some(block => block.blockId === 'copper-vein'), false);
  const serialized = JSON.stringify(view);
  for (const key of ['seed', 'rngState', 'drops', 'chanceBps', 'chunks', 'catalog']) assert.equal(serialized.includes(`"${key}"`), false);
  world = harvest(world, floor(world), shovel).state;
  world = harvest(world, floor(world), shovel).state;
  world = harvest(world, floor(world), pickaxe).state;
  assert.ok(worldView(world, actor).region!.blocks.some(block => block.blockId === 'copper-vein' && block.position.x === hidden.x && block.position.z === hidden.z));
  assert.equal(worldView(world, actor).region!.blocks.some(block => block.position.x === 2 && block.position.y === 1 && block.position.z === 1), false);
});

test('closing deletes geometry, seals each owner cargo and retains experience without granting inventory', () => {
  let world = harvest(enter(), floor(enter()), shovel).state;
  world = harvest(world, floor(world), { ...shovel, ownerCharacterId: member.characterId }, member).state;
  const before = structuredClone(world);
  const result = command(world, { type: 'close' });
  assert.equal(result.outcome.manifests.length, 2); assert.equal(new Set(result.outcome.manifests.map(entry => entry.id)).size, 2);
  for (const manifest of result.outcome.manifests) {
    const gatherer = before.gatherers.find(entry => entry.characterId === manifest.characterId)!;
    assert.deepEqual(manifest.cargo, gatherer.cargo); assert.equal(manifest.playerId, gatherer.playerId);
  }
  assert.equal(result.state.status, 'closed'); assert.equal(result.state.location, null);
  assert.deepEqual(result.state.map, []); assert.deepEqual(result.state.regions, []);
  assert.ok(result.state.gatherers.every(entry => entry.cargo.length === 0 && entry.xp === 1));
  assert.throws(() => command(result.state, { type: 'enter' }), /закрыта/);
  assert.throws(() => command(result.state, { type: 'close' }), /закрыта/);
  assert.deepEqual(world, before);
});
