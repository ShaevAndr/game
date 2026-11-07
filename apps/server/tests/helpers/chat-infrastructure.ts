import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import type { Account, AccountLogin, AccountSession, Character, ChatFeed, ChatMessage } from '@game/core';
import { ChatRepository } from '../../src/modules/chat/ports/chat.repository';
import { ChatClock } from '../../src/modules/chat/ports/chat-clock';
import { ChatEvents } from '../../src/modules/chat/ports/chat-events';
import { Database } from '../../src/infrastructure/database/database.service';

export async function verifyChat(app: INestApplication, origin: string, primaryToken: string, accounts: Account[]) {
  const call = async <T>(token: string, path: string, body?: object, expected = body ? 201 : 200) => {
    const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value as T;
  };
  const session = await call<AccountSession>(primaryToken, '/identity/session');
  const second = await call<AccountLogin>('', '/identity/session', { accountId: accounts[1].id });
  const observer = await call<Account>('', '/accounts', { name: 'Наблюдатель чата' });
  const third = await call<AccountLogin>('', '/identity/session', { accountId: observer.id });
  const otherHero = (await call<Character[]>(second.token, '/characters'))[0];
  await call(second.token, '/identity/session/character', { characterId: otherHero.id });
  const clock = app.get(ChatClock), originalClock = clock.now; let now = Date.now(); clock.now = () => now;
  const sockets: Socket[] = [], notifications = new Map<string, string[]>();
  const connect = async (token: string) => {
    const socket = io(`${origin}/chat`, { autoConnect: false, reconnection: false, auth: { token } }); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); socket.connect(); });
    const ack = await new Promise<{ ok?: boolean }>(resolve => socket.emit('subscribe', resolve)); assert.equal(ack.ok, true);
    const ids: string[] = []; notifications.set(token, ids); socket.on('message.created', (event: { messageId: string }) => ids.push(event.messageId));
    return socket;
  };
  const body = (text: string, recipientPlayerId?: string, authorCharacterId = session.characterId!) => ({ operationId: randomUUID(), authorCharacterId,
    destination: recipientPlayerId ? { kind: 'direct', recipientPlayerId } : { kind: 'world' }, segments: [{ kind: 'text', text }] });
  const feed = (token: string, view = 'all', cursor = '') => call<ChatFeed>(token, `/chat/feed?view=${view}${cursor}`);
  const db = app.get(Database), repository = app.get(ChatRepository);
  try {
    const oneSocket = await connect(primaryToken), twoSocket = await connect(second.token); await connect(third.token);
    const firstBody = body('Первое сообщение мира');
    const attempts = await Promise.all([0, 1].map(async () => {
      const response = await fetch(`${origin}/api/v1/chat/messages`, { method: 'POST', headers: { Authorization: `Bearer ${primaryToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(firstBody) });
      return { status: response.status, message: await response.json() as ChatMessage };
    }));
    assert.deepEqual(attempts.map(attempt => attempt.status).sort(), [200, 201]);
    const [first, replay] = attempts.map(attempt => attempt.message);
    assert.equal(first.id, replay.id);
    assert.equal((await db.sql.selectFrom('chat_messages').selectAll().execute()).length, 1);
    assert.equal((await db.sql.selectFrom('chat_deliveries').selectAll().execute()).length, 1);
    await call(primaryToken, '/chat/messages', { ...firstBody, segments: [{ kind: 'text', text: 'Подмена повтора' }] }, 409);
    const until = async (check: () => boolean) => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } assert.fail('Missing chat notification'); };
    await until(() => notifications.get(third.token)!.includes(first.id));
    const originalFeed = await feed(second.token), privateBody = body('Только адресату', accounts[1].id);
    const personal = await call<ChatMessage>(primaryToken, '/chat/messages', privateBody);
    await until(() => notifications.get(second.token)!.includes(personal.id));
    assert.ok(!notifications.get(third.token)!.includes(personal.id));
    assert.deepEqual((await feed(third.token)).messages.map(message => message.id), [first.id]);
    assert.deepEqual((await feed(second.token, 'direct')).messages.map(message => message.id), [personal.id]);
    assert.deepEqual((await feed(primaryToken, 'direct')).messages.map(message => message.id), [personal.id]);
    const caughtUp = await feed(second.token, 'all', `&after=${encodeURIComponent(originalFeed.after)}`);
    assert.deepEqual(caughtUp.messages.map(message => message.id), [personal.id]);
    await call(third.token, `/chat/feed?after=${encodeURIComponent(caughtUp.after)}`, undefined, 410);
    await call(primaryToken, '/chat/messages', body('Подмена героя', undefined, otherHero.id), 403);
    await call(primaryToken, '/chat/messages', { ...body('Подмена отправителя'), senderPlayerId: observer.id }, 400);
    await call(primaryToken, '/chat/messages', body('Самому себе', session.account.id), 400);
    await call(primaryToken, '/chat/messages', { ...body('x'), destination: { kind: 'all' } }, 400);
    await call(primaryToken, '/chat/messages', body('x'.repeat(1001)), 400);
    const snapshot = await db.sql.selectFrom('chat_streams').selectAll().orderBy('stream_key').execute();
    const save = repository.save, failedBody = body('Откат транзакции', accounts[1].id);
    repository.save = async (...args) => { await save.apply(repository, args); throw new Error('simulated chat commit failure'); };
    try { await call(primaryToken, '/chat/messages', failedBody, 500); } finally { repository.save = save; }
    assert.deepEqual(await db.sql.selectFrom('chat_streams').selectAll().orderBy('stream_key').execute(), snapshot);
    assert.equal((await db.sql.selectFrom('chat_operations').selectAll().where('operation_id', '=', failedBody.operationId).execute()).length, 0);
    const succeeded = await call<ChatMessage>(primaryToken, '/chat/messages', failedBody);
    const initial = await call<ChatFeed>(primaryToken, '/chat/feed?view=all&limit=1');
    const ids = initial.messages.map(message => message.id); let older = initial;
    while (older.hasMore) { older = await call(primaryToken, `/chat/feed?view=all&limit=1&before=${encodeURIComponent(older.before)}`); ids.push(...older.messages.map(message => message.id)); }
    assert.equal(new Set(ids).size, 3); assert.ok(ids.includes(succeeded.id));
    twoSocket.disconnect();
    const beforeOffline = await feed(second.token);
    const offline = await call<ChatMessage>(primaryToken, '/chat/messages', body('Личное офлайн', accounts[1].id));
    assert.ok((await feed(second.token, 'all', `&after=${encodeURIComponent(beforeOffline.after)}`)).messages.some(message => message.id === offline.id));
    // Enforce one limit across world and private deliveries, under concurrent sender locks.
    await call(primaryToken, '/chat/messages', body('Пятое сообщение'));
    const limitedResponse = await fetch(`${origin}/api/v1/chat/messages`, { method: 'POST', headers: { Authorization: `Bearer ${primaryToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body('Лимит')) });
    assert.equal(limitedResponse.status, 429); assert.equal(limitedResponse.headers.get('retry-after'), '10');
    now += 10001;
    const events = app.get(ChatEvents), publish = events.publish;
    events.publish = async () => { throw new Error('push unavailable'); };
    let withoutPush: ChatMessage;
    try { withoutPush = await call(primaryToken, '/chat/messages', body('Восстановление без WS')); } finally { events.publish = publish; }
    assert.ok((await feed(primaryToken, 'world')).messages.some(message => message.id === withoutPush.id));
    const returned = await connect(second.token); assert.ok(returned.connected);
    assert.ok((await feed(second.token)).messages.some(message => message.id === offline.id));
    oneSocket.disconnect();
    return first.id;
  } finally { sockets.forEach(socket => socket.disconnect()); clock.now = originalClock; }
}
