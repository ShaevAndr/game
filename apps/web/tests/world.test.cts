import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { InventoryView, WorldExpeditionView } from '@game/core';
import { parsePendingWorldCommand } from '../src/features/world/model/commands';
import { reachableBlock, stepTarget, worldTools } from '../src/features/world/model/interaction';

test('browser recovery preserves the exact admitted command and rejects malformed storage', () => {
  const pending = { kind: 'action', worldId: randomUUID(), command: { operationId: randomUUID(), expectedRevision: 23,
    action: { type: 'harvest', position: { x: 3, y: 2, z: 4 }, toolInstanceId: randomUUID() } } };
  assert.deepEqual(parsePendingWorldCommand(JSON.stringify(pending)), pending);
  assert.equal(parsePendingWorldCommand('{broken'), null);
  assert.equal(parsePendingWorldCommand(JSON.stringify({ ...pending, command: { ...pending.command, expectedRevision: -1 } })), null);
  assert.equal(parsePendingWorldCommand(JSON.stringify({ ...pending, command: { ...pending.command, toolClassId: 'axe' } })), null);
});

test('target hints distinguish adjacent blocks, diagonals and blocks above the head', () => {
  const origin = { x: 5, y: 4, z: 7 };
  for (const target of [{ x: 5, y: 3, z: 7 }, { x: 5, y: 6, z: 7 }, { x: 6, y: 5, z: 7 }]) assert.equal(reachableBlock(origin, target), true);
  for (const target of [{ x: 6, y: 3, z: 7 }, { x: 6, y: 4, z: 8 }, { x: 5, y: 7, z: 7 }]) assert.equal(reachableBlock(origin, target), false);
});

test('movement intents use observed supports, allow one height step, and respect arbitrary region bounds', () => {
  const view = { location: { cellId: '0:0', position: { x: 2, y: 3, z: 2 } }, region: { size: { x: 7, y: 11, z: 9 }, blocks: [] } } as unknown as WorldExpeditionView;
  view.region!.blocks = [{ position: { x: 3, y: 3, z: 2 }, blockId: 'stone' }];
  assert.deepEqual(stepTarget(view, 1, 0), { x: 3, y: 4, z: 2 });
  view.region!.blocks.push({ position: { x: 3, y: 5, z: 2 }, blockId: 'leaves' });
  assert.equal(stepTarget(view, 1, 0), null);
  assert.equal(stepTarget(view, 1, 1), null);
  assert.equal(stepTarget(view, 0, -1), null); // Unknown ground is not invented by the client.
  view.location!.position = { x: 6, y: 3, z: 2 };
  assert.equal(stepTarget(view, 1, 0), null);
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
