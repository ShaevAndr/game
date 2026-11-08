import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import type { Account, AccountLogin, Character, ChatFeed, ChatMessage, ChatSend, PartyAction, PartyCommandResult, PartyState, SocialState } from '@game/core';
import { ChatRepository } from '../../src/modules/chat/ports/chat.repository';
import { ChatClock } from '../../src/modules/chat/ports/chat-clock';
import { ChatEvents } from '../../src/modules/chat/ports/chat-events';
import { Database } from '../../src/infrastructure/database/database.service';

export async function verifyPartyChat(app: INestApplication, origin: string) {
  const call = async <T>(token: string, path: string, body?: object, expected = body ? 201 : 200): Promise<T> => {
    const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value as T;
  };
  const actors = [];
  for (const label of ['А', 'Б', 'В', 'Г']) {
    const account = await call<Account>('', '/accounts', { name: `Чат группы ${label} ${randomUUID().slice(0, 6)}` });
    const login = await call<AccountLogin>('', '/identity/session', { accountId: account.id });
    const hero = await call<Character>(login.token, '/characters', { name: `Герой чата ${label}` });
    await call(login.token, '/identity/session/character', { characterId: hero.id });
    actors.push({ account, hero, token: login.token });
  }
  type Actor = typeof actors[number];
  const [a, b, c, d] = actors, sockets: Socket[] = [], notifications = new Map<string, string[]>();
  const state = (actor: Actor) => call<PartyState>(actor.token, '/parties');
  const command = async (actor: Actor, action: PartyAction) => {
    const current = await state(actor);
    return call<PartyCommandResult>(actor.token, '/parties/actions', { operationId: randomUUID(), expectedPartyId: current.party?.id ?? null, expectedRevision: current.party?.revision ?? 0, action });
  };
  const recruit = async (leader: Actor, actor: Actor) => {
    const invitation = await command(leader, { type: 'invite', targetPlayerId: actor.account.id });
    await command(actor, { type: 'accept', invitationId: invitation.invitationId! });
  };
  const feed = (actor: Actor, view = 'party', cursor = '', expected = 200) => call<ChatFeed>(actor.token, `/chat/feed?view=${view}${cursor}`, undefined, expected);
  const clock = app.get(ChatClock), originalNow = clock.now; let now = Date.now(); clock.now = () => now;
  const body = (actor: Actor, partyId: string, text: string): ChatSend => ({ operationId: randomUUID(), authorCharacterId: actor.hero.id, destination: { kind: 'party', partyId }, segments: [{ kind: 'text', text }] });
  const send = async (actor: Actor, partyId: string, text: string, expected = 201) => { now++; return call<ChatMessage>(actor.token, '/chat/messages', body(actor, partyId, text), expected); };
  const waitFor = async (check: () => boolean) => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail('Expected party chat event'); };
  const db = app.get(Database);
  try {
    await recruit(a, b);
    const group = (await state(a)).party!, partyId = group.id;
    const originalMembershipB = group.members.find(member => member.playerId === b.account.id)!.membershipId;
    for (const actor of actors) {
      const socket = io(`${origin}/chat`, { autoConnect: false, reconnection: false, auth: { token: actor.token } }); sockets.push(socket);
      notifications.set(actor.token, []);
      await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); socket.connect(); });
      assert.equal((await new Promise<{ ok: boolean }>(resolve => socket.emit('subscribe', resolve))).ok, true);
      socket.on('message.created', (event: { messageId: string; channel: string; partyId?: string }) => { if (event.channel === 'party') { assert.ok(event.partyId); notifications.get(actor.token)!.push(event.messageId); } });
    }
    await send(c, partyId, 'Чужая группа', 409);
    const firstBody = body(a, partyId, 'До вступления В');
    const firstReplies = await Promise.all([0, 1].map(() => fetch(`${origin}/api/v1/chat/messages`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(firstBody) })));
    assert.deepEqual(firstReplies.map(reply => reply.status).sort(), [200, 201]);
    const first = await firstReplies[0].json() as ChatMessage;
    assert.equal(first.channel, 'party'); assert.equal(first.partyId, partyId); assert.equal('partyRecipients' in first, false);
    assert.equal((await db.sql.selectFrom('chat_deliveries').selectAll().where('message_id', '=', first.id).execute()).length, 2);
    await waitFor(() => notifications.get(b.token)!.includes(first.id));
    assert.ok(!notifications.get(c.token)!.includes(first.id)); assert.ok(!notifications.get(d.token)!.includes(first.id));
    assert.deepEqual((await feed(b)).messages.map(message => message.id), [first.id]);
    assert.ok((await feed(b, 'all')).messages.some(message => message.id === first.id));
    assert.ok(!(await feed(b, 'world')).messages.some(message => message.id === first.id));
    assert.ok(!(await feed(b, 'direct')).messages.some(message => message.id === first.id));
    assert.ok(!(await feed(d, 'all')).messages.some(message => message.id === first.id));
    const cursorB = await feed(b);
    await feed(d, 'party', `&after=${encodeURIComponent(cursorB.after)}`, 410);
    await call(d.token, '/chat/messages', { ...body(d, partyId, 'Подмена'), senderPlayerId: a.account.id }, 400);

    await recruit(a, c);
    assert.deepEqual((await feed(c)).messages, [], 'new members have no pre-join deliveries');
    const second = await send(a, partyId, 'Все трое в группе');
    const fromB = body(b, partyId, 'Сообщение Б');
    const bMessage = await call<ChatMessage>(b.token, '/chat/messages', fromB);
    await waitFor(() => notifications.get(b.token)!.includes(bMessage.id));
    assert.ok(!(await feed(c)).messages.some(message => message.id === first.id));
    await command(b, { type: 'leave' });
    await feed(b, 'party', `&after=${encodeURIComponent(cursorB.after)}`, 410);
    assert.deepEqual((await feed(b)).messages, []); assert.ok(!(await feed(b, 'all')).messages.some(message => message.partyId === partyId));
    await send(b, partyId, 'После выхода', 409);
    await call(b.token, '/chat/messages', fromB, 200); // Receipt replay creates no new delivery.
    const notificationCount = notifications.get(b.token)!.length;
    const absence = await send(a, partyId, 'Пока Б отсутствует');
    assert.equal(notifications.get(b.token)!.length, notificationCount);
    await app.get(ChatEvents).publish(first, [{ playerId: b.account.id, membershipId: originalMembershipB }]);
    assert.equal(notifications.get(b.token)!.length, notificationCount, 'delayed push is revoked on leave');
    await recruit(a, b);
    const newMembershipB = (await state(b)).party!.members.find(member => member.playerId === b.account.id)!.membershipId;
    assert.notEqual(newMembershipB, originalMembershipB);
    await feed(b, 'party', `&after=${encodeURIComponent(cursorB.after)}`, 410);
    await app.get(ChatEvents).publish(first, [{ playerId: b.account.id, membershipId: originalMembershipB }]);
    assert.equal(notifications.get(b.token)!.length, notificationCount, 'old membership cannot receive delayed push after rejoin');
    const third = await send(a, partyId, 'Б вернулся');
    const rejoined = await feed(b);
    assert.ok(rejoined.messages.some(message => message.id === first.id));
    assert.ok(rejoined.messages.some(message => message.id === second.id));
    assert.ok(rejoined.messages.some(message => message.id === third.id));
    assert.ok(!rejoined.messages.some(message => message.id === absence.id));
    const pages: string[] = []; let page = await call<ChatFeed>(b.token, '/chat/feed?view=all&limit=1');
    for (;;) { pages.push(...page.messages.map(message => message.id)); if (!page.hasMore) break; page = await call<ChatFeed>(b.token, `/chat/feed?view=all&limit=1&before=${encodeURIComponent(page.before)}`); }
    assert.equal(new Set(pages).size, pages.length); assert.ok(!pages.includes(absence.id));

    // Group, world and direct messages spend one sender quota.
    await call(a.token, '/chat/messages', { operationId: randomUUID(), authorCharacterId: a.hero.id, destination: { kind: 'world' }, segments: [{ kind: 'text', text: 'Пятое общее сообщение' }] });
    await call(a.token, '/chat/messages', { operationId: randomUUID(), authorCharacterId: a.hero.id, destination: { kind: 'direct', recipientPlayerId: d.account.id }, segments: [{ kind: 'text', text: 'Лимит общий' }] }, 429);
    now += 10001;
    const stableCursor = await feed(a);
    await command(a, { type: 'transfer', targetPlayerId: c.account.id });
    await feed(a, 'party', `&after=${encodeURIComponent(stableCursor.after)}`); // Leadership does not change membership access.

    const social = async (action: 'block' | 'unblock') => {
      const policy = await call<SocialState>(c.token, '/social');
      await call(c.token, '/social/actions', { operationId: randomUUID(), targetPlayerId: a.account.id, expectedRevision: policy.relationships.find(row => row.playerId === a.account.id)?.revision ?? 0, action });
    };
    const beforeBlock = await feed(c); await social('block');
    await feed(c, 'party', `&after=${encodeURIComponent(beforeBlock.after)}`, 410);
    const blocked = await send(a, partyId, 'Скрыто у В, доступно у Б');
    assert.ok(!(await feed(c)).messages.some(message => message.senderPlayerId === a.account.id));
    assert.ok(!notifications.get(c.token)!.includes(blocked.id));
    assert.ok((await feed(b)).messages.some(message => message.id === blocked.id));
    await social('unblock'); assert.ok((await feed(c)).messages.some(message => message.id === blocked.id));

    const repository = app.get(ChatRepository), save = repository.save, failed = body(a, partyId, 'Атомарная выдача в группу');
    const beforeFailure = await db.sql.selectFrom('chat_streams').selectAll().orderBy('stream_key').execute();
    repository.save = async (...args) => { await save.apply(repository, args); throw new Error('party chat save failure'); };
    try { await call(a.token, '/chat/messages', failed, 500); } finally { repository.save = save; }
    assert.deepEqual(await db.sql.selectFrom('chat_streams').selectAll().orderBy('stream_key').execute(), beforeFailure);
    assert.equal((await db.sql.selectFrom('chat_operations').selectAll().where('operation_id', '=', failed.operationId).execute()).length, 0);
    await call(a.token, '/chat/messages', failed);
    sockets[1].disconnect(); const beforeOffline = await feed(b);
    const offline = await send(a, partyId, 'Доставка без WebSocket');
    assert.ok((await feed(b, 'party', `&after=${encodeURIComponent(beforeOffline.after)}`)).messages.some(message => message.id === offline.id));

    // Kick and send serialize through the same membership lock.
    const current = await state(c), raced = body(b, partyId, 'Гонка исключения');
    const [sent, kicked] = await Promise.all([
      fetch(`${origin}/api/v1/chat/messages`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(raced) }),
      fetch(`${origin}/api/v1/parties/actions`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: randomUUID(), expectedPartyId: partyId, expectedRevision: current.party!.revision, action: { type: 'kick', targetPlayerId: b.account.id } }) }),
    ]);
    assert.ok([201, 409].includes(sent.status)); assert.equal(kicked.status, 201);
    assert.deepEqual((await feed(b)).messages, []); await send(b, partyId, 'После исключения', 409);
    const formerCursor = await feed(a); await command(c, { type: 'disband' });
    await feed(a, 'party', `&after=${encodeURIComponent(formerCursor.after)}`, 410);
    assert.deepEqual((await feed(a)).messages, []);
    await recruit(a, c);
    const freshPartyId = (await state(a)).party!.id; assert.notEqual(freshPartyId, partyId);
    assert.deepEqual((await feed(c)).messages, []);
    const checkpoint = await send(a, freshPartyId, 'Группа после перезапуска');
    assert.deepEqual((await feed(c)).messages.map(message => message.id), [checkpoint.id]);
    return { token: c.token, outsiderToken: d.token, messageId: checkpoint.id };
  } finally { clock.now = originalNow; for (const socket of sockets) socket.disconnect(); }
}
