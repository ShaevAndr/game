import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { WorldDelivery, WorldPartySnapshot, WorldIdentity } from '@game/core';
import { memoryWorld } from './helpers/memory-world';

async function fixture() {
  const f = memoryWorld(), worldId = randomUUID();
  const leader: WorldIdentity = { playerId: randomUUID(), characterId: randomUUID(), partyId: randomUUID(), membershipId: randomUUID() };
  const member = { ...leader, playerId: randomUUID(), characterId: randomUUID(), membershipId: randomUUID() };
  const party: WorldPartySnapshot = { id: leader.partyId, revision: 1, leaderPlayerId: leader.playerId,
    members: [leader, member].map(({ partyId: _, ...entry }) => entry) };
  let sequence = 0;
  const envelope = (payload: WorldDelivery['payload']): WorldDelivery => ({ worldId, id: randomUUID(), sequence: ++sequence, payload: structuredClone(payload) });
  const send = (payload: WorldDelivery['payload']) => f.deliveries.deliver(envelope(payload));
  const act = async (actor: WorldIdentity, action: { type: 'enter' | 'leave' | 'close' } | { type: 'harvest'; position: { x: number; y: number; z: number }; toolInstanceId: string }) => {
    const state = await f.service.get(worldId, actor);
    return send({ kind: 'action', party, request: { actor, command: { operationId: randomUUID(), expectedRevision: state.revision, action },
      ...(action.type === 'harvest' ? { tool: { instanceId: action.toolInstanceId, ownerCharacterId: actor.characterId, toolClassId: 'shovel' } } : {}) } });
  };
  await send({ kind: 'start', actor: leader, operationId: randomUUID(), party });
  await act(leader, { type: 'enter' });
  const mine = async (actor = leader) => {
    const p = (await f.service.get(worldId, actor)).location!.position!;
    return act(actor, { type: 'harvest', position: { ...p, y: p.y - 1 }, toolInstanceId: randomUUID() });
  };
  return { ...f, worldId, leader, member, party, envelope, send, act, mine };
}

test('ordered admissions survive lost replies and reject gaps, altered envelopes and new late starts', async () => {
  const f = await fixture();
  const one = f.envelope({ kind: 'party', party: f.party }), two = f.envelope({ kind: 'party', party: f.party });
  await assert.rejects(f.deliveries.deliver(two), { status: 409 });
  await f.deliveries.deliver(one); const result = await f.deliveries.deliver(two), before = f.inspect();
  assert.deepEqual(await f.deliveries.deliver(two), result); assert.deepEqual(f.inspect(), before);
  await assert.rejects(f.deliveries.deliver({ ...two, id: randomUUID() }), { status: 409 });
  const lateStart = await f.send({ kind: 'start', actor: f.leader, operationId: randomUUID(), party: f.party });
  assert.equal(lateStart.status, 409); assert.equal((await f.service.get(f.worldId, f.leader)).ownerFence, 1);
});

test('leadership transfer preserves the world and terrain and advances the ownership fence', async () => {
  const f = await fixture(); await f.mine(); const before = await f.service.get(f.worldId, f.leader);
  f.party.leaderPlayerId = f.member.playerId; f.party.revision++;
  await f.send({ kind: 'party', party: f.party });
  const after = await f.service.get(f.worldId, f.member);
  assert.equal(after.id, before.id); assert.deepEqual(after.location, before.location); assert.deepEqual(after.region, before.region);
  assert.equal(after.ownerFence, 2); assert.equal(after.revision, before.revision + 1);
  assert.equal((await f.act(f.leader, { type: 'leave' })).status, 400);
  assert.equal((await f.act(f.member, { type: 'leave' })).status, 201);
});

test('exclusion seals private cargo; rejoining gets the altered world, prior XP and a new membership', async () => {
  const f = await fixture(); await f.mine(f.member);
  const original = await f.service.get(f.worldId, f.member);
  f.party.members = f.party.members.filter(member => member.playerId !== f.member.playerId); f.party.revision++;
  await f.send({ kind: 'party', party: f.party });
  await assert.rejects(f.service.get(f.worldId, f.member), { status: 403 });
  const manifests = await f.service.manifests(f.worldId, { playerId: f.member.playerId, characterId: f.member.characterId });
  assert.deepEqual(manifests[0].cargo, original.cargo);
  f.member.membershipId = randomUUID();
  f.party.members.push({ playerId: f.member.playerId, characterId: f.member.characterId, membershipId: f.member.membershipId }); f.party.revision++;
  await f.send({ kind: 'party', party: f.party });
  const rejoined = await f.service.get(f.worldId, f.member);
  assert.equal(rejoined.xp, 1); assert.deepEqual(rejoined.cargo, []); assert.deepEqual(rejoined.region, original.region);
  await f.mine(f.member);
  f.party.members = f.party.members.filter(member => member.playerId !== f.member.playerId); f.party.revision++;
  await f.send({ kind: 'party', party: f.party });
  const twice = await f.service.manifests(f.worldId, { playerId: f.member.playerId, characterId: f.member.characterId });
  assert.equal(twice.length, 2); assert.equal(new Set(twice.map(entry => entry.id)).size, 2);
});

test('disband closes the expedition, preserves cargo, and a late projection cannot reopen it', async () => {
  const f = await fixture(); await f.mine();
  await f.send({ kind: 'party', party: null });
  const stored = f.inspect().worlds.get(f.worldId)!;
  assert.equal(stored.state.status, 'closed'); assert.deepEqual(stored.state.regions, []);
  const cargo = [...f.inspect().manifests.values()]; assert.equal(cargo.length, 1);
  await f.send({ kind: 'party', party: f.party });
  assert.equal(f.inspect().worlds.get(f.worldId)!.state.status, 'closed'); assert.deepEqual([...f.inspect().manifests.values()], cargo);
});

test('delivery receipt failure rolls back the game mutation and its normal operation receipt', async () => {
  const f = await fixture(), state = await f.service.get(f.worldId, f.leader), p = state.location!.position!, toolInstanceId = randomUUID();
  const request = f.envelope({ kind: 'action', party: f.party, request: { actor: f.leader,
    command: { operationId: randomUUID(), expectedRevision: state.revision, action: { type: 'harvest', position: { ...p, y: p.y - 1 }, toolInstanceId } },
    tool: { instanceId: toolInstanceId, ownerCharacterId: f.leader.characterId, toolClassId: 'shovel' } } });
  const before = f.inspect(); f.failNext('delivery');
  await assert.rejects(f.deliveries.deliver(request), /Delivery persistence failed/); assert.deepEqual(f.inspect(), before);
  assert.equal((await f.deliveries.deliver(request)).status, 201); assert.equal((await f.service.get(f.worldId, f.leader)).xp, 1);
});
