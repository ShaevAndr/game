import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Character, GatheringAction, GatheringReceipt, GatheringView, InventoryView } from '@game/core';
import { Database } from '../../src/infrastructure/database/database.service';
import { GatheringRepository } from '../../src/modules/gathering/ports/gathering.repository';

type Request = <T>(path: string, body?: object, status?: number) => Promise<T>;

export async function verifyGathering(app: INestApplication, origin: string, token: string, request: Request) {
  const hero = await request<Character>('/characters', { name: 'Исследователь земель' });
  const path = `/characters/${hero.id}/gathering`;
  const get = () => request<GatheringView>(path);
  const command = (expectedRevision: number, action: GatheringAction, operationId = randomUUID()) => ({ operationId, expectedRevision, action });
  const inventory = () => request<InventoryView>(`/characters/${hero.id}/inventories`);
  const total = (view: InventoryView, itemId: string) => view.items.filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0);
  const initialInventory = await inventory();
  const initial = await get();
  assert.equal(initial.revision, 0); assert.equal(initial.expedition, null);
  assert.equal(initial.areas.length, 3); assert.equal(initial.atlas.length, 0);
  await request(`${path}/actions`, { ...command(0, { type: 'skip' }), success: true }, 400);
  await request(`${path}/actions`, command(0, { type: 'start', areaId: 'forest', routeId: 'crystal-fault' }), 400);
  const start = command(0, { type: 'start', areaId: 'forest', routeId: 'forest-edge' });
  const [first, replay] = await Promise.all([
    request<GatheringReceipt>(`${path}/actions`, start), request<GatheringReceipt>(`${path}/actions`, start),
  ]);
  assert.deepEqual(first, replay); assert.equal(first.view.revision, 1);
  assert.equal('sites' in first.view.expedition!, false);
  assert.deepEqual(await get(), first.view);
  await request(`${path}/actions`, { ...start, action: { type: 'skip' } }, 409);

  // Different operations at the same revision must not both harvest the stop.
  const responses = await Promise.all(Array.from({ length: 2 }, () => fetch(`${origin}/api/v1${path}/actions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command(1, { type: 'harvest', resourceId: 'herb-patch', methodId: 'pick' })),
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const harvested = await get();
  assert.equal(harvested.xp, 1); assert.equal(harvested.revision, 2);
  assert.equal(harvested.expedition!.step, 1);
  assert.deepEqual(harvested.expedition!.cargo, [{ itemId: 'healing-herb', quantity: 3 }]);
  assert.equal(total(await inventory(), 'healing-herb'), total(initialInventory, 'healing-herb'));
  await request(`${path}/actions`, command(2, { type: 'harvest', resourceId: 'fire-geode', methodId: 'extract' }), 400);
  assert.deepEqual(await get(), harvested);

  // Failure after canonical inventory writes must roll back inventory, state and receipt.
  const repository = app.get(GatheringRepository);
  const finish = repository.finish;
  const returning = command(2, { type: 'return' });
  repository.finish = async () => { throw new Error('simulated gathering receipt failure'); };
  try { await request(`${path}/actions`, returning, 500); }
  finally { repository.finish = finish; }
  assert.deepEqual(await get(), harvested);
  assert.deepEqual(await inventory(), initialInventory);
  const returned = await request<GatheringReceipt>(`${path}/actions`, returning);
  assert.equal(returned.view.expedition, null);
  assert.deepEqual(await request(`${path}/actions`, returning), returned);
  assert.equal(total(await inventory(), 'healing-herb'), total(initialInventory, 'healing-herb') + 3);
  assert.equal((await inventory()).items.length, initialInventory.items.length, 'compatible stacks reuse their slots');

  const begun = await request<GatheringReceipt>(`${path}/actions`, command(3, { type: 'start', areaId: 'forest', routeId: 'pine-slope' }));
  const wood = await request<GatheringReceipt>(`${path}/actions`, command(begun.view.revision, { type: 'harvest', resourceId: 'fallen-oak', methodId: 'branches' }));
  const database = app.get(Database);
  const beforeFullReturn = await inventory();
  const bag = beforeFullReturn.inventories.find(bag => bag.primary)!;
  await database.sql.updateTable('inventories').set({ capacity: beforeFullReturn.items.length }).where('id', '=', bag.id).execute();
  const fullReturn = command(wood.view.revision, { type: 'return' });
  await request(`${path}/actions`, fullReturn, 400);
  assert.deepEqual(await get(), wood.view, 'full backpack preserves expedition and cargo');
  assert.equal(total(await inventory(), 'oak-wood'), 0);
  assert.equal(await database.sql.selectFrom('gathering_operations').select('operation_id').where('operation_id', '=', fullReturn.operationId).executeTakeFirst(), undefined);
  await database.sql.updateTable('inventories').set({ capacity: bag.capacity }).where('id', '=', bag.id).execute();
  const woodReturned = await request<GatheringReceipt>(`${path}/actions`, fullReturn);
  assert.equal(total(await inventory(), 'oak-wood'), 3);
  await request(`${path}/actions`, command(wood.view.revision, { type: 'return' }), 409);

  // Leave a non-empty expedition and a replayable receipt across the real process restart.
  const checkpointStart = await request<GatheringReceipt>(`${path}/actions`, command(woodReturned.view.revision, { type: 'start', areaId: 'highlands', routeId: 'stone-ravine' }));
  const checkpointCommand = command(checkpointStart.view.revision, { type: 'harvest', resourceId: 'flint-outcrop', methodId: 'pick' });
  const checkpoint = await request<GatheringReceipt>(`${path}/actions`, checkpointCommand);
  assert.ok(checkpoint.view.atlas.length > 0);
  return { heroId: hero.id, receipt: checkpoint, command: checkpointCommand };
}
