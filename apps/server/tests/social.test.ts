import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SocialCommand, SocialPair, SocialRelationship } from '@game/core';
import { SocialService } from '../src/modules/social/application/social.service';
import { SocialPlayer, SocialRepository } from '../src/modules/social/ports/social.repository';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { TransactionContext, UnitOfWork } from '../src/shared/application/unit-of-work';

function fixture() {
  type State = { players: Record<string, SocialPlayer>; pairs: Record<string, SocialPair>; receipts: Record<string, { signature: string; result: SocialRelationship | null }> };
  let state: State = { players: {}, pairs: {}, receipts: {} }, tail = Promise.resolve(), failure = false;
  const drafts = new Map<TransactionContext, State>(), ids: string[] = [randomUUID(), randomUUID(), randomUUID()], key = (one: string, two: string) => [one, two].sort().join(':');
  const transactions: UnitOfWork = { async run<T>(work: (context: TransactionContext) => Promise<T>) {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    const context = { id: Symbol() }, draft = structuredClone(state); drafts.set(context, draft);
    try { const result = await work(context); state = draft; return result; } finally { drafts.delete(context); release(); }
  } };
  const repository: SocialRepository = {
    async claim(id, op, signature, context) { return drafts.get(context)!.receipts[id + op] ??= { signature, result: null }; },
    async lockPlayers(ids, context) { return [...new Set(ids)].sort().map(id => drafts.get(context)!.players[id] ??= { id, revision: 0, visibilityRevision: 0 }); },
    async pair(one, two, context) { return (context ? drafts.get(context)! : state).pairs[key(one, two)]; },
    async pairs(id, context) { return Object.values(drafts.get(context)!.pairs).filter(pair => pair.lowId === id || pair.highId === id); },
    async save(pair, _players, context) { drafts.get(context)!.pairs[key(pair.lowId, pair.highId)] = pair; if (failure) throw new Error('save failed'); },
    async complete(id, op, result, context) { drafts.get(context)!.receipts[id + op].result = result; },
  };
  const identity = { list: async () => ids.map(id => ({ id, name: id, createdAt: new Date().toISOString() })), getAccount: async (id: string) => { if (!ids.includes(id)) throw new Error('Игрок не найден'); return { id, name: id, createdAt: new Date().toISOString() }; } } as IdentityService;
  const service = new SocialService(transactions, repository, identity);
  const input = (action: SocialCommand['action'], targetPlayerId = ids[1], expectedRevision = 0): SocialCommand => ({ operationId: randomUUID(), targetPlayerId, action, expectedRevision });
  return { service, ids, input, transactions, state: () => state, fail: (value: boolean) => { failure = value; } };
}

test('crossed friend requests converge to one accepted relationship, and exact retries retain their result', async () => {
  const f = fixture(), one = f.input('friend-request'), two = f.input('friend-request', f.ids[0]);
  await Promise.all([f.service.command(f.ids[0], one), f.service.command(f.ids[1], two)]);
  assert.equal(Object.keys(f.state().pairs).length, 1);
  assert.equal((await f.service.state(f.ids[0])).relationships[0].friendship, 'accepted');
  const replay = await f.service.command(f.ids[0], one); assert.equal(replay.replayed, true); assert.equal(replay.relationship.friendship, 'outgoing');
  await assert.rejects(f.service.command(f.ids[0], { ...one, action: 'block' }), /ключ/);
  assert.deepEqual((await f.service.state(f.ids[2])).relationships, []);
});
test('a request needs the other player to accept; decline/cancel and stale commands cannot alter a newer state', async () => {
  const f = fixture(); await f.service.command(f.ids[0], f.input('friend-request'));
  await assert.rejects(f.service.command(f.ids[0], f.input('friend-accept', f.ids[1], 1)), /входящей/);
  await assert.rejects(f.service.command(f.ids[1], f.input('friend-decline', f.ids[0], 0)), /изменились/);
  await f.service.command(f.ids[1], f.input('friend-decline', f.ids[0], 1));
  assert.equal((await f.service.state(f.ids[0])).relationships[0].friendship, 'none');
  await f.service.command(f.ids[0], f.input('friend-request', f.ids[1], 2));
  await f.service.command(f.ids[0], f.input('friend-cancel', f.ids[1], 3));
  assert.equal((await f.service.state(f.ids[1])).relationships[0].friendship, 'none');
});
test('blocking is directional for visibility, mutual for interaction, cancels friendship and does not restore it on unblock', async () => {
  const f = fixture(); await f.service.command(f.ids[0], f.input('friend-request'));
  await f.service.command(f.ids[1], f.input('friend-accept', f.ids[0], 1));
  await f.service.command(f.ids[0], f.input('block', f.ids[1], 2));
  const blocker = await f.service.state(f.ids[0]), other = await f.service.state(f.ids[1]);
  assert.equal(blocker.relationships[0].blocked, true); assert.equal(other.relationships[0].blocked, false);
  assert.equal(other.relationships[0].friendship, 'none'); assert.equal(blocker.visibilityRevision, 1); assert.equal(other.visibilityRevision, 0);
  assert.equal(await f.service.canSeeAuthor(f.ids[0], f.ids[1]), false); assert.equal(await f.service.canSeeAuthor(f.ids[1], f.ids[0]), true);
  for (const [one, two] of [[f.ids[0], f.ids[1]], [f.ids[1], f.ids[0]]]) {
    await assert.rejects(f.transactions.run(context => f.service.assertCanInteract(one, two, context)), /недоступно/);
    await assert.rejects(f.service.command(one, f.input('friend-request', two, 3)), /недоступно/);
  }
  await f.service.command(f.ids[0], f.input('unblock', f.ids[1], 3));
  await f.transactions.run(context => f.service.assertCanInteract(f.ids[1], f.ids[0], context));
  assert.equal((await f.service.state(f.ids[0])).relationships[0].friendship, 'none');
  assert.equal((await f.service.state(f.ids[0])).visibilityRevision, 2);
});
test('failed persistence rolls back the relationship, player revisions and operation receipt', async () => {
  const f = fixture(), command = f.input('block'); f.fail(true);
  await assert.rejects(f.service.command(f.ids[0], command), /save failed/);
  assert.deepEqual(f.state(), { players: {}, pairs: {}, receipts: {} });
  f.fail(false); await f.service.command(f.ids[0], command);
  assert.equal((await f.service.state(f.ids[0])).relationships[0].blocked, true);
  await assert.rejects(f.service.command(f.ids[0], f.input('block', f.ids[0])), /другого/);
});
