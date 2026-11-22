import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import type { Account, AccountLogin, Character, StateInvalidation, StateTopic } from '@game/core';
import { AppModule } from '../src/app.module';
import { Database } from '../src/infrastructure/database/database.service';
import { StateChanges } from '../src/shared/application/state-changes';
import { ValidationFilter } from '../src/shared/http/validation.filter';

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(20); }
  assert.fail('No state invalidation received');
}

test('account push: commit/rollback, recipients, subscriptions, mutations and expired sessions', { timeout: 90_000 }, async () => {
  const name = `updates_${randomUUID().replaceAll('-', '')}`, namespace = `test-${name}`;
  const pgUrl = process.env.TEST_POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const mongoUrl = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const admin = new Pool({ connectionString: pgUrl }), mongo = new MongoClient(mongoUrl), redis = new Redis(redisUrl);
  const keys = ['POSTGRES_URL', 'MONGO_URL', 'MONGO_DB', 'REDIS_URL', 'REDIS_NAMESPACE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const clients: Socket[] = [];
  let app: INestApplication | undefined, created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const isolated = new URL(pgUrl); isolated.pathname = `/${name}`;
    Object.assign(process.env, { POSTGRES_URL: isolated.toString(), MONGO_URL: mongoUrl, MONGO_DB: name, REDIS_URL: redisUrl, REDIS_NAMESPACE: namespace });
    await mongo.connect();
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ValidationFilter()); await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const request = async <T>(path: string, token = '', body?: unknown): Promise<T> => {
      const response = await fetch(`${origin}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value as T;
    };
    const accounts = await request<Account[]>('/accounts');
    const sessions = await Promise.all(accounts.map(account => request<AccountLogin>('/identity/session', '', { accountId: account.id })));
    const heroes = await Promise.all(sessions.map(session => request<Character[]>('/characters', session.token)));
    await Promise.all(sessions.map((session, i) => request('/identity/session/character', session.token, { characterId: heroes[i][0].id })));
    const subscribe = async (token: string, topics: StateTopic[]) => {
      const socket = io(`${origin}/updates`, { autoConnect: false, forceNew: true, transports: ['websocket'], auth: { token } });
      clients.push(socket); const events: StateInvalidation[] = []; socket.on('state.changed', value => events.push(value));
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
      const ack = await socket.timeout(2000).emitWithAck('subscribe', topics);
      return { socket, events, ack };
    };
    const first = await subscribe(sessions[0].token, ['parties', 'social', 'arena', 'characters', 'rooms']);
    const second = await subscribe(sessions[1].token, ['parties', 'social', 'arena', 'rooms']);
    const rejected = await subscribe('f'.repeat(64), ['rooms']); assert.ok(rejected.ack.error);
    assert.equal(first.ack.ok, true); assert.equal(second.ack.ok, true);
    // Joining can legitimately invalidate online room availability. Isolate subsequent assertions.
    await delay(50); first.events.length = 0; second.events.length = 0; rejected.events.length = 0;
    const db = app.get(Database), changes = app.get(StateChanges);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const work = db.run(async context => { changes.publish({ topics: ['parties'], accountIds: [accounts[0].id] }, context); entered(); await gate; });
    await started; await delay(30); assert.equal(first.events.length, 0);
    release(); await work; await until(() => first.events.length === 1);
    assert.equal(second.events.length, 0); assert.deepEqual(first.events[0], { topics: ['parties'] });
    await assert.rejects(db.run(async context => { changes.publish({ topics: ['social'], accountIds: [accounts[0].id] }, context); throw new Error('rollback'); }));
    await delay(30); assert.equal(first.events.length, 1);
    // Public directory events require a current page subscription; arbitrary private broadcasts are rejected.
    await first.socket.timeout(2000).emitWithAck('subscribe', ['parties']);
    changes.publish({ topics: ['rooms', 'social'] }); await until(() => second.events.some(event => event.topics.includes('rooms')));
    assert.equal(first.events.length, 1); assert.equal(rejected.events.length, 0);
    await first.socket.timeout(2000).emitWithAck('subscribe', ['parties', 'social', 'arena', 'characters', 'rooms']);
    const socialBefore = second.events.length;
    await request('/social/actions', sessions[0].token, { operationId: randomUUID(), targetPlayerId: accounts[1].id, expectedRevision: 0, action: 'friend-request' });
    await until(() => second.events.slice(socialBefore).some(event => event.topics.includes('social')));
    const partyBefore = second.events.length;
    await request('/parties/actions', sessions[0].token, { operationId: randomUUID(), expectedPartyId: null, expectedRevision: 0, action: { type: 'invite', targetPlayerId: accounts[1].id } });
    await until(() => second.events.slice(partyBefore).some(event => event.topics.includes('parties')));
    const directoryBefore = second.events.length;
    const room = await request<{ id: string }>('/battles', sessions[0].token, { characterId: heroes[0][0].id, name: 'Push test', kind: 'duel', rule: 'on-match' });
    await until(() => second.events.slice(directoryBefore).some(event => event.topics.includes('rooms')));
    const arenaBefore = first.events.length;
    await request(`/battles/${room.id}/challenges`, sessions[1].token, { characterId: heroes[1][0].id });
    await until(() => first.events.slice(arenaBefore).some(event => event.topics.includes('arena')));
    const listed = await request<{ incoming: unknown[] }>(`/battles/arena/${heroes[0][0].id}`, sessions[0].token); assert.equal(listed.incoming.length, 1);
    const offer = listed.incoming[0] as { id: string };
    const startBefore = second.events.length;
    const startedBattle = await request<{ id: string; version: number }>(`/battles/${room.id}/challenges/${offer.id}/accept`, sessions[0].token, { characterId: heroes[0][0].id });
    await until(() => second.events.slice(startBefore).some(event => event.topics.includes('arena')));
    const active = await request<{ activeBattleId: string }>(`/battles/arena/${heroes[1][0].id}`, sessions[1].token);
    assert.equal(active.activeBattleId, startedBattle.id);
    const characterBefore = first.events.length;
    await request(`/characters/${heroes[0][0].id}/skills`, sessions[0].token, { skillId: 'strike' });
    await until(() => first.events.slice(characterBefore).some(event => event.topics.includes('characters')));
    // A revoked token cannot keep receiving changes on an already subscribed socket.
    await fetch(`${origin}/api/v1/identity/session`, { method: 'DELETE', headers: { authorization: `Bearer ${sessions[0].token}` } });
    const count = first.events.length;
    changes.publish({ topics: ['social'], accountIds: [accounts[0].id] });
    await until(() => !first.socket.connected); assert.equal(first.events.length, count);
  } finally {
    clients.forEach(socket => socket.disconnect()); await app?.close();
    if (created) { await mongo.db(name).dropDatabase(); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
    for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
    await mongo.close(); await redis.quit(); await admin.end();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
