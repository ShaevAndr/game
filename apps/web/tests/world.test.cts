import { replayWorldInputs } from '../src/features/world/model/movement';
import { projectWorldToNoa } from '../src/features/world/model/noa-projection';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { InventoryView, WorldExpeditionView } from '@game/core';
import { parsePendingWorldCommand } from '../src/features/world/model/commands';
import { reachableBlock, directionFrames, worldTools } from '../src/features/world/model/interaction';

test('browser recovery preserves the exact admitted command and rejects malformed storage', () => {
  const pending = { kind: 'action', worldId: randomUUID(), command: { operationId: randomUUID(), expectedRevision: 23,
    action: { type: 'harvest', position: { x: 3, y: 2, z: 4 }, toolInstanceId: randomUUID() } } };
  assert.deepEqual(parsePendingWorldCommand(JSON.stringify(pending)), pending);
  assert.equal(parsePendingWorldCommand('{broken'), null);
  assert.equal(parsePendingWorldCommand(JSON.stringify({ ...pending, command: { ...pending.command, expectedRevision: -1 } })), null);
  assert.equal(parsePendingWorldCommand(JSON.stringify({ ...pending, command: { ...pending.command, toolClassId: 'axe' } })), null);
});

test('target hints use physical reach for fractional positions and small voxels', () => {
  const origin = { x: 5.25, y: 4, z: 7.75 };
  assert.equal(reachableBlock(origin, { x: 5, y: 3, z: 7 }), true);
  assert.equal(reachableBlock(origin, { x: 6, y: 4, z: 8 }), true);
  assert.equal(reachableBlock(origin, { x: 15, y: 4, z: 7 }), false);
});
test('fallback directions emit fractional movement inputs and continue the server sequence', () => {
  const view = { location: { motion: { sequence: 4 } } } as WorldExpeditionView;
  const frames = directionFrames(view, .6, .8, true);
  assert.equal(frames[0].sequence, 5); assert.equal(frames[1].sequence, 6);
  assert.equal(frames[0].jump, true); assert.equal(frames[1].jump, false);
  assert.equal(frames[0].x, .6); assert.equal(frames[0].z, .8);
});

test('tool selector uses canonical backpack instances and excludes equipment, outside items and other bags', () => {
  const inventory = { ownerId: 'hero', definitions: [{ id: 'axe-a', name: 'Один топор', toolClassId: 'axe' }, { id: 'axe-b', name: 'Другой топор', toolClassId: 'axe' }, { id: 'ore', name: 'Руда' }],
    inventories: [{ id: 'primary', primary: true }], items: [
      { id: 'a', itemId: 'axe-a', inventoryId: 'primary', actions: [] }, { id: 'b', itemId: 'axe-b', inventoryId: 'primary', actions: [] },
      { id: 'c', itemId: 'axe-a', inventoryId: 'primary', equippedSlot: 'weapon', actions: [] }, { id: 'd', itemId: 'axe-a', inventoryId: 'other', actions: [] },
      { id: 'e', itemId: 'axe-a', inventoryId: null, actions: [] }, { id: 'f', itemId: 'ore', inventoryId: 'primary', actions: [] },
    ] } as unknown as InventoryView;
  assert.deepEqual(worldTools(inventory).map(tool => [tool.id, tool.toolClassId]), [['a', 'axe'], ['b', 'axe']]);
});

test('tool menu filters by the targeted resource and excludes unrelated tool classes', () => {
  const inventory = { definitions: [{ id: 'axe', name: 'Топор', toolClassId: 'axe' }, { id: 'pick', name: 'Кирка', toolClassId: 'pickaxe' }, { id: 'sword', name: 'Меч' }],
    inventories: [{ id: 'bag', primary: true }], items: [
      { id: 'axe', itemId: 'axe', inventoryId: 'bag', actions: [] },
      { id: 'pick', itemId: 'pick', inventoryId: 'bag', actions: [] },
      { id: 'sword', itemId: 'sword', inventoryId: 'bag', actions: [] },
    ] } as unknown as InventoryView;
  assert.deepEqual(worldTools(inventory, ['pickaxe']).map(tool => tool.id), ['pick']);
  assert.deepEqual(worldTools(inventory, []).map(tool => tool.id), []);
});

test('noa collision projection keeps sealed voxels solid and opens only connected air', async () => {
  const region = { size: { x: 5, y: 6, z: 7 }, palette: [{ id: 'wall' }], blocks: [] } as unknown as NonNullable<WorldExpeditionView['region']>;
  // A closed shell hides its centre from the public view.
  for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) for (let z = 1; z <= 3; z++) if (x !== 2 || y !== 2 || z !== 2) region.blocks.push({ position: { x, y, z }, blockId: 'wall' });
  const projection = projectWorldToNoa(region, { x: 0, y: 0, z: 0 });
  assert.equal(projection.voxel({ x: 0, y: 1, z: 0 }), 0);
  assert.equal(projection.voxel({ x: 2, y: 2, z: 2 }), 1);
  assert.equal(projection.voxel({ x: -1, y: 0, z: 0 }), 1);
  assert.ok(projection.voxel({ x: 1, y: 1, z: 1 }) > 1);
  region.blocks = region.blocks.filter(block => !(block.position.x === 1 && block.position.y === 2 && block.position.z === 2));
  const opened = projectWorldToNoa(region, { x: 0, y: 0, z: 0 }, projection.types);
  assert.equal(opened.voxel({ x: 2, y: 2, z: 2 }), 0);
  assert.equal(opened.types.get('wall'), projection.types.get('wall'));
});


test('reconciliation replays only unconfirmed inputs without applying acknowledged motion twice', () => {
  const solid = (p: { x: number; y: number; z: number }) => p.y < 2;
  const baseline = { position: { x: 8.5, y: 2, z: 8.5 }, motion: { sequence: 0, grounded: true, velocity: { x: 0, y: 0, z: 0 } } };
  const inputs = Array.from({ length: 4 }, (_, index) => ({ sequence: index + 1, x: .6, z: .8, jump: index === 0 }));
  const predicted = replayWorldInputs(baseline, inputs, solid, .5), acknowledged = replayWorldInputs(baseline, inputs.slice(0, 2), solid, .5);
  assert.deepEqual(replayWorldInputs(acknowledged, inputs, solid, .5), predicted);
  assert.ok(predicted.position.x > baseline.position.x && predicted.position.z > baseline.position.z && predicted.position.y > baseline.position.y);
  assert.throws(() => replayWorldInputs(baseline, inputs.slice(1), solid, .5), /последовательность/);
});
