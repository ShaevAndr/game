import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccountSession, ChatEntry, ChatMessage, ChatSend, directChatStream } from '@game/core';
import { SocialService } from '../src/modules/social/application/social.service';
import { ChatService } from '../src/modules/chat/application/chat.service';
import { PartiesService } from '../src/modules/parties/application/parties.service';
import { ChatRepository, ChatStream } from '../src/modules/chat/ports/chat.repository';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { TransactionContext, UnitOfWork } from '../src/shared/application/unit-of-work';

function fixture() {
  type State = { receipts: Record<string, { signature: string; message: ChatMessage | null }>; streams: Record<string, ChatStream>; entries: ChatEntry[] };
  let state: State = { receipts: {}, streams: {}, entries: [] }, now = Date.now(), failure = false, tail = Promise.resolve();
  const drafts = new Map<TransactionContext, State>(), published: ChatMessage[] = [];
  const sessions: AccountSession[] = Array.from({ length: 3 }, (_, i) => ({ account: { id: randomUUID(), name: `Игрок ${i + 1}`, createdAt: new Date(now).toISOString() }, characterId: randomUUID(), expiresAt: now + 86400000 }));
  const tx: UnitOfWork = { async run<T>(work: (context: TransactionContext) => Promise<T>) {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    const context = { id: Symbol('chat') }, draft = structuredClone(state); drafts.set(context, draft);
    try { const result = await work(context); state = draft; return result; }
    finally { drafts.delete(context); release(); }
  } };
  const repository: ChatRepository = {
    async claim(sender, id, signature, context) { return drafts.get(context)!.receipts[`${sender}:${id}`] ??= { signature, message: null }; },
    async lockStreams(keys, context) { return [...new Set(keys)].sort().map(key => drafts.get(context)!.streams[key] ??= { id: randomUUID(), key, sequence: 0 }); },
    async recentCount(sender, since, context) { return new Set(drafts.get(context)!.entries.filter(item => item.message.senderPlayerId === sender && Date.parse(item.message.createdAt) > since).map(item => item.message.id)).size; },
    async save(message, streams, context) {
      const draft = drafts.get(context)!;
      for (const stream of streams) { stream.sequence++; draft.entries.push({ streamKey: stream.key, sequence: stream.sequence, message }); }
      draft.receipts[`${message.senderPlayerId}:${message.operationId}`].message = message;
      if (failure) throw new Error('save failed');
    },
    async heads(keys) { return Object.fromEntries(keys.map(key => [key, state.streams[key]?.sequence ?? 0])); },
    async entries(key, from, to, direction, limit) { return state.entries.filter(item => item.streamKey === key && item.sequence > from && item.sequence <= to).sort((a, b) => direction === 'after' ? a.sequence - b.sequence : b.sequence - a.sequence).slice(0, limit); },
  };
  const identity = { getAccount: async (id: string) => { const account = sessions.find(session => session.account.id === id)?.account; if (!account) throw new Error('Игрок не найден'); return account; } } as IdentityService;
  const characters = { identity: async (id: string) => { const owner = sessions.find(session => session.characterId === id)!; return { id, name: `Герой ${owner.account.name}`, accountId: owner.account.id }; } } as CharactersService;
  const events = { async publish(message: ChatMessage) { assert.ok(state.entries.some(entry => entry.message.id === message.id), 'push follows commit'); published.push(message); } };
  const service = new ChatService(tx, repository, identity, characters, events, { now: () => now }, { assertCanInteract: async () => {}, readPolicy: async () => ({ revision: 0, hiddenAuthors: [] }) } as unknown as SocialService, { chatAccess: async () => null } as unknown as PartiesService);
  const input = (session = sessions[0], recipientId?: string): ChatSend => ({ operationId: randomUUID(), authorCharacterId: session.characterId!, destination: recipientId ? { kind: 'direct', recipientPlayerId: recipientId } : { kind: 'world' }, segments: [{ kind: 'text', text: 'Привет' }] });
  return { service, sessions, input, published, state: () => state, fail: (value: boolean) => { failure = value; }, advance: (ms: number) => { now += ms; } };
}

test('concurrent duplicate sends persist and publish once; a different body cannot reuse the key', async () => {
  const f = fixture(), body = f.input(), [one, two] = await Promise.all([f.service.send(f.sessions[0], body), f.service.send(f.sessions[0], body)]);
  assert.equal(one.message.id, two.message.id); assert.equal(Number(one.replayed) + Number(two.replayed), 1);
  assert.equal(f.published.length, 1); assert.equal(f.state().entries.length, 1);
  await assert.rejects(f.service.send(f.sessions[0], { ...body, segments: [{ kind: 'text', text: 'Другой текст' }] }), /ключ/);
});
test('a failed write rolls back all streams, deliveries and receipts; the same command can then succeed', async () => {
  const f = fixture(), body = f.input(f.sessions[0], f.sessions[1].account.id); f.fail(true);
  await assert.rejects(f.service.send(f.sessions[0], body), /save failed/);
  assert.deepEqual(f.state(), { receipts: {}, streams: {}, entries: [] }); assert.equal(f.published.length, 0);
  f.fail(false); await f.service.send(f.sessions[0], body);
  assert.equal(f.state().entries.length, 2); assert.equal(f.published.length, 1);
});
test('direct messages appear only in the two account inboxes and all remains a per-player view', async () => {
  const f = fixture();
  const world = await f.service.send(f.sessions[0], f.input());
  const personal = await f.service.send(f.sessions[0], f.input(f.sessions[0], f.sessions[1].account.id));
  const third = await f.service.feed(f.sessions[2].account.id, { view: 'all' });
  assert.deepEqual(third.messages.map(message => message.id), [world.message.id]);
  assert.deepEqual((await f.service.feed(f.sessions[1].account.id, { view: 'direct' })).messages.map(message => message.id), [personal.message.id]);
  assert.equal(f.state().entries.filter(entry => entry.streamKey === directChatStream(f.sessions[0].account.id)).length, 1);
});
test('one rate limit covers world and direct sends; successful retries do not spend it again', async () => {
  const f = fixture(), first = f.input(); await f.service.send(f.sessions[0], first);
  for (let i = 0; i < 4; i++) await f.service.send(f.sessions[0], f.input(f.sessions[0], i % 2 ? f.sessions[1].account.id : undefined));
  await assert.rejects(f.service.send(f.sessions[0], f.input()), /пяти сообщений/);
  assert.equal((await f.service.send(f.sessions[0], first)).replayed, true);
  f.advance(10001); assert.equal((await f.service.send(f.sessions[0], f.input())).replayed, false);
});
test('history and forward cursors paginate both streams without duplicates or timestamp-based loss', async () => {
  const f = fixture(), ids: string[] = [];
  for (let i = 0; i < 4; i++) { f.advance(10); ids.push((await f.service.send(f.sessions[0], f.input(f.sessions[0], i % 2 ? f.sessions[1].account.id : undefined))).message.id); }
  const initial = await f.service.feed(f.sessions[0].account.id, { view: 'all', limit: 1 });
  const older: string[] = initial.messages.map(message => message.id); let page = initial;
  while (page.hasMore) { page = await f.service.feed(f.sessions[0].account.id, { view: 'all', limit: 1, before: page.before }); older.push(...page.messages.map(message => message.id)); }
  assert.deepEqual(older, [...ids].reverse());
  // A later commit with an older timestamp must still be recovered from its stream offset.
  f.advance(-50); const later = await f.service.send(f.sessions[0], f.input(f.sessions[0], f.sessions[1].account.id));
  assert.deepEqual((await f.service.feed(f.sessions[0].account.id, { view: 'all', after: initial.after })).messages.map(message => message.id), [later.message.id]);
  await assert.rejects(f.service.feed(f.sessions[1].account.id, { view: 'all', after: initial.after }), /заново/);
  await assert.rejects(f.service.feed(f.sessions[0].account.id, { view: 'world', after: initial.after }), /заново/);
});
test('forged or unselected characters cannot send and self-addressed private messages are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.service.send({ ...f.sessions[0], characterId: null }, f.input()), /Выберите персонажа/);
  await assert.rejects(f.service.send(f.sessions[0], f.input(f.sessions[1])), /Выберите персонажа/);
  await assert.rejects(f.service.send(f.sessions[0], f.input(f.sessions[0], f.sessions[0].account.id)), /другого адресата/);
  assert.equal(f.published.length, 0);
});

test('a party ID without current membership cannot create any message, delivery or receipt', async () => {
  const f = fixture();
  await assert.rejects(f.service.send(f.sessions[0], { ...f.input(), destination: { kind: 'party', partyId: randomUUID() } }), /больше не состоите/);
  assert.deepEqual(f.state(), { receipts: {}, streams: {}, entries: [] });
  const empty = await f.service.feed(f.sessions[0].account.id, { view: 'party' });
  assert.deepEqual(empty.messages, []); assert.equal(empty.partyAccess, null);
});
