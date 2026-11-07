import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import type { Account, AccountLogin, AccountSession, Character, ChatFeed, ChatMessage, SocialAction, SocialCommand, SocialState } from '@game/core';
import { SocialRepository } from '../../src/modules/social/ports/social.repository';
import { Database } from '../../src/infrastructure/database/database.service';

export async function verifySocial(app: INestApplication, origin: string, primaryToken: string, accounts: Account[]) {
  const call = async <T>(token: string, path: string, body?: object, expected = body ? 201 : 200): Promise<T> => {
    const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result as T;
  };
  const login = await call<AccountLogin>('', '/identity/session', { accountId: accounts[1].id }), otherToken = login.token;
  const hero = (await call<Character[]>(otherToken, '/characters'))[0]; await call(otherToken, '/identity/session/character', { characterId: hero.id });
  const primary = await call<AccountSession>(primaryToken, '/identity/session');
  const state = (token: string) => call<SocialState>(token, '/social');
  const command = async (token: string, targetPlayerId: string, action: SocialAction, expected = 201) => {
    const current = await state(token), body: SocialCommand = { operationId: randomUUID(), targetPlayerId, action, expectedRevision: current.relationships.find(row => row.playerId === targetPlayerId)?.revision ?? 0 };
    await call(token, '/social/actions', body, expected); return body;
  };
  const sockets: Socket[] = [];
  try {
    const one: SocialCommand = { operationId: randomUUID(), targetPlayerId: accounts[1].id, expectedRevision: 0, action: 'friend-request' };
    const two = { ...one, operationId: randomUUID(), targetPlayerId: accounts[0].id };
    await Promise.all([call(primaryToken, '/social/actions', one), call(otherToken, '/social/actions', two)]);
    assert.equal((await state(primaryToken)).relationships[0].friendship, 'accepted');
    assert.equal((await state(otherToken)).relationships[0].friendship, 'accepted');
    await call(primaryToken, '/social/actions', one, 200);
    await call(primaryToken, '/social/actions', { ...one, action: 'block' }, 409);
    await command(primaryToken, accounts[1].id, 'friend-remove');
    await command(primaryToken, accounts[1].id, 'friend-request');
    await command(otherToken, accounts[0].id, 'block');
    assert.equal((await state(primaryToken)).relationships[0].friendship, 'none');
    const send = (token: string, text: string, direct = true, expected = 201) => call<ChatMessage>(token, '/chat/messages', { operationId: randomUUID(), authorCharacterId: token === primaryToken ? primary.characterId : hero.id,
      destination: direct ? { kind: 'direct', recipientPlayerId: token === primaryToken ? accounts[1].id : accounts[0].id } : { kind: 'world' }, segments: [{ kind: 'text', text }] }, expected);
    await send(otherToken, 'Запрет от блокировавшего', true, 403); await send(primaryToken, 'Запрет к блокировавшему', true, 403);
    await command(primaryToken, accounts[1].id, 'friend-request', 403);
    await command(primaryToken, accounts[1].id.toUpperCase(), 'friend-request', 403);
    const primaryState = await state(primaryToken);
    assert.equal(primaryState.relationships[0].blocked, false); assert.ok(!JSON.stringify(primaryState).includes('blockedBy'));
    await command(otherToken, accounts[0].id, 'unblock');
    const privateBefore = await send(otherToken, 'Личное до блокировки'), worldBefore = await send(otherToken, 'Мир до блокировки', false);
    const notifications: string[] = [];
    const socket = io(`${origin}/chat`, { autoConnect: false, reconnection: false, auth: { token: primaryToken } }); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); socket.connect(); });
    assert.equal((await new Promise<{ ok: boolean }>(resolve => socket.emit('subscribe', resolve))).ok, true);
    socket.on('message.created', (event: { messageId: string }) => notifications.push(event.messageId));
    const previousFeed = await call<ChatFeed>(primaryToken, '/chat/feed');
    await command(primaryToken, accounts[1].id, 'block');
    await call(primaryToken, `/chat/feed?after=${encodeURIComponent(previousFeed.after)}`, undefined, 410);
    const blockedFeed = await call<ChatFeed>(primaryToken, '/chat/feed');
    assert.ok(!blockedFeed.messages.some(message => [privateBefore.id, worldBefore.id].includes(message.id)));
    assert.ok((await call<ChatFeed>(otherToken, '/chat/feed')).messages.some(message => message.id === privateBefore.id));
    const hiddenWorld = await send(otherToken, 'Мир после блокировки', false);
    const hiddenCatchup = await call<ChatFeed>(primaryToken, `/chat/feed?after=${encodeURIComponent(blockedFeed.after)}`);
    assert.deepEqual(hiddenCatchup.messages, []); assert.notEqual(hiddenCatchup.after, blockedFeed.after);
    assert.ok(!notifications.includes(hiddenWorld.id));
    await command(primaryToken, accounts[1].id, 'unblock');
    assert.ok((await call<ChatFeed>(primaryToken, '/chat/feed')).messages.some(message => message.id === privateBefore.id));
    // Either accepted-before-block or rejected-after-block is valid; no later send may pass.
    const raceInput: SocialCommand = { operationId: randomUUID(), targetPlayerId: accounts[1].id, action: 'block', expectedRevision: (await state(primaryToken)).relationships[0].revision };
    const [racedSend, racedBlock] = await Promise.all([
      fetch(`${origin}/api/v1/chat/messages`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: randomUUID(), authorCharacterId: hero.id, destination: { kind: 'direct', recipientPlayerId: accounts[0].id }, segments: [{ kind: 'text', text: 'Гонка с ЧС' }] }) }),
      fetch(`${origin}/api/v1/social/actions`, { method: 'POST', headers: { Authorization: `Bearer ${primaryToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(raceInput) }),
    ]);
    assert.ok([201, 403].includes(racedSend.status)); assert.equal(racedBlock.status, 201);
    await send(otherToken, 'После гонки', true, 403);
    const blocked = await state(primaryToken), failed: SocialCommand = { operationId: randomUUID(), action: 'unblock', targetPlayerId: accounts[1].id, expectedRevision: blocked.relationships[0].revision };
    const repository = app.get(SocialRepository), save = repository.save;
    repository.save = async (...args) => { await save.apply(repository, args); throw new Error('social save failure'); };
    try { await call(primaryToken, '/social/actions', failed, 500); } finally { repository.save = save; }
    assert.deepEqual(await state(primaryToken), blocked);
    assert.equal((await app.get(Database).sql.selectFrom('social_operations').selectAll().where('operation_id', '=', failed.operationId).execute()).length, 0);
    await call(primaryToken, '/social/actions', failed);
    await command(primaryToken, accounts[1].id, 'block');
    await call(primaryToken, '/social/actions', { operationId: randomUUID(), targetPlayerId: accounts[0].id.toUpperCase(), action: 'block', expectedRevision: 0 }, 400);
    return accounts[1].id;
  } finally { sockets.forEach(socket => socket.disconnect()); }
}
