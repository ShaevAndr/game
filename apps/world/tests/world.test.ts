import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { WorldAction, WorldTool } from '@game/core';
import { executeWorldSchema, startWorldSchema, type ExecuteWorldRequest, type WorldIdentity } from '../src/shared/application/world-contracts';
import { memoryWorld } from './helpers/memory-world';

async function fixture() {
  const store = memoryWorld();
  const actor: WorldIdentity = { playerId: randomUUID(), characterId: randomUUID(), membershipId: randomUUID(), partyId: randomUUID() };
  const member: WorldIdentity = { ...actor, playerId: randomUUID(), characterId: randomUUID(), membershipId: randomUUID() };
  const worldId = randomUUID(), tool: WorldTool = { instanceId: randomUUID(), ownerCharacterId: actor.characterId, toolClassId: 'shovel' };
  const members = [actor, member].map(({ partyId: _, ...entry }) => entry);
  const start = { worldId, operationId: randomUUID(), actor, members };
  await store.service.start(start);
  const request = async (action: WorldAction, who = actor, selectedTool?: WorldTool): Promise<ExecuteWorldRequest> => ({ actor: who,
    command: { operationId: randomUUID(), expectedRevision: (await store.service.get(worldId, who)).revision, action }, ...(selectedTool ? { tool: selectedTool } : {}) });
  const act = async (action: WorldAction, who = actor, selectedTool?: WorldTool) => store.service.execute(worldId, await request(action, who, selectedTool));
  await act({ type: 'enter' });
  const position = (await store.service.get(worldId, actor)).location!.position!;
  const harvest = await request({ type: 'harvest', position: { ...position, y: position.y - 1 }, toolInstanceId: tool.instanceId }, actor, tool);
  return { ...store, actor, member, worldId, tool, start, request, act, harvest };
}

test('the same command returns its original acknowledgement before checking the now-stale revision', async () => {
  const f = await fixture(); const result = await f.service.execute(f.worldId, f.harvest); const after = f.inspect();
  assert.deepEqual(await f.service.execute(f.worldId, structuredClone(f.harvest)), result);
  assert.deepEqual(f.inspect(), after);
  assert.equal((await f.service.get(f.worldId, f.actor)).xp, 1);
  assert.equal('view' in result, false); assert.equal('rolls' in result.outcome, false);
  assert.deepEqual(await f.service.start(f.start), { worldId: f.worldId, operationId: f.start.operationId, revision: 0,
    outcome: { type: 'start', success: true, loot: [], xpGained: 0, manifestIds: [] } });
});

test('changed payload or identity with the same operation ID conflicts, and stale fresh commands cannot gain twice', async () => {
  const f = await fixture(); await f.service.execute(f.worldId, f.harvest);
  const changed = structuredClone(f.harvest); changed.tool!.toolClassId = 'axe';
  await assert.rejects(f.service.execute(f.worldId, changed), { status: 409 });
  const stale = structuredClone(f.harvest); stale.command.operationId = randomUUID();
  await assert.rejects(f.service.execute(f.worldId, stale), { status: 409 });
  const wrongMembership = structuredClone(f.harvest); wrongMembership.actor.membershipId = randomUUID();
  await assert.rejects(f.service.execute(f.worldId, wrongMembership), { status: 403 });
  assert.equal((await f.service.get(f.worldId, f.actor)).xp, 1);
});

test('receipt failure rolls back the changed block, cargo, experience and RNG together', async () => {
  const f = await fixture(), before = f.inspect();
  f.failNext('finish'); await assert.rejects(f.service.execute(f.worldId, f.harvest), /Receipt persistence failed/);
  assert.deepEqual(f.inspect(), before);
  const result = await f.service.execute(f.worldId, f.harvest);
  assert.equal(result.outcome.xpGained, 1); assert.equal((await f.service.get(f.worldId, f.actor)).xp, 1);
});

test('closing and sealing cargo are atomic; old acknowledgements survive deletion of geometry', async () => {
  const f = await fixture(), result = await f.service.execute(f.worldId, f.harvest);
  const before = f.inspect(), close = await f.request({ type: 'close' });
  f.failNext('seal'); await assert.rejects(f.service.execute(f.worldId, close), /Manifest persistence failed/);
  assert.deepEqual(f.inspect(), before);
  const closed = await f.service.execute(f.worldId, close);
  assert.deepEqual(await f.service.execute(f.worldId, close), closed);
  assert.deepEqual(await f.service.execute(f.worldId, f.harvest), result);
  const state = await f.service.get(f.worldId, f.actor);
  assert.equal(state.status, 'closed'); assert.equal(state.region, null); assert.equal(state.map.length, 0); assert.equal(state.xp, 1);
  assert.deepEqual((await f.service.manifests(f.worldId, {playerId: f.actor.playerId, characterId: f.actor.characterId}))[0].cargo, result.outcome.loot);
  assert.deepEqual(await f.service.manifests(f.worldId, {playerId: f.member.playerId, characterId: f.member.characterId}), []);
});

test('one active expedition per party and persistent experience carry into the next expedition', async () => {
  const f = await fixture();
  await assert.rejects(f.service.start({ ...f.start, worldId: randomUUID(), operationId: randomUUID() }), { status: 409 });
  await f.service.execute(f.worldId, f.harvest); await f.act({ type: 'close' });
  const next = { ...f.start, worldId: randomUUID(), operationId: randomUUID() };
  await f.service.start(next);
  const state = await f.service.get(next.worldId, f.actor);
  assert.equal(state.xp, 1); assert.deepEqual(state.cargo, []);
});

test('concurrent members targeting one block yield only one successful transition', async () => {
  const f = await fixture(); const competing = structuredClone(f.harvest);
  competing.actor = f.member; competing.command.operationId = randomUUID(); competing.tool!.ownerCharacterId = f.member.characterId;
  const results = await Promise.allSettled([f.service.execute(f.worldId, f.harvest), f.service.execute(f.worldId, competing)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await f.service.get(f.worldId, f.actor)).xp + (await f.service.get(f.worldId, f.member)).xp, 1);
});

test('strict request contracts reject extra authority fields, duplicate members and oversized parties', async () => {
  const f = await fixture();
  assert.equal(startWorldSchema.safeParse({ ...f.start, members: [...f.start.members, f.start.members[0]] }).success, false);
  assert.equal(startWorldSchema.safeParse({ ...f.start, members: [...f.start.members,
    ...Array.from({ length: 5 }, () => ({ playerId: randomUUID(), characterId: randomUUID(), membershipId: randomUUID() }))] }).success, false);
  assert.equal(startWorldSchema.safeParse({ ...f.start, seed: 1 }).success, false);
  assert.equal(executeWorldSchema.safeParse({ ...f.harvest, actor: { ...f.actor, isLeader: true } }).success, false);
  await assert.rejects(f.service.get(f.worldId, { ...f.actor, partyId: randomUUID() }), { status: 403 });
  await assert.rejects(f.act({ type: 'leave' }, f.member), { status: 400 });
});

test('UUID casing and object key order do not change identity or operation signatures', async () => {
  const f = await fixture(), result = await f.service.execute(f.worldId, f.harvest);
  const upper = structuredClone(f.harvest);
  upper.command.operationId = upper.command.operationId.toUpperCase();
  if (upper.command.action.type === 'harvest') upper.command.action.toolInstanceId = upper.command.action.toolInstanceId.toUpperCase();
  for (const key of ['playerId', 'characterId', 'partyId', 'membershipId'] as const) upper.actor[key] = upper.actor[key].toUpperCase();
  upper.tool!.instanceId = upper.tool!.instanceId.toUpperCase(); upper.tool!.ownerCharacterId = upper.tool!.ownerCharacterId.toUpperCase();
  assert.deepEqual(await f.service.execute(f.worldId.toUpperCase(), upper), result);
  assert.deepEqual(await f.service.get(f.worldId.toUpperCase(), upper.actor), await f.service.get(f.worldId, f.actor));
});
