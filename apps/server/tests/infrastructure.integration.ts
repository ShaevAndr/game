import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';
import { Battle, Character, Content, possibleMove } from '@game/core';
import { AppModule } from '../src/app.module';
import { Database } from '../src/infrastructure/database/database.service';
import { Cache } from '../src/shared/application/cache.port';
import { TaskQueue } from '../src/shared/application/task-queue.port';
import { BattleHistoryRepository } from '../src/modules/battle-history/ports/battle-history.repository';
import { ValidationFilter } from '../src/shared/http/validation.filter';
import { BullMqTaskQueue } from '../src/infrastructure/queues/bullmq-task-queue';
import { RedisCache } from '../src/infrastructure/redis/redis-cache';

async function eventually(check: () => Promise<boolean>, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail('Expected background work did not finish in time');
}

test('real infrastructure: REST commands, WS push, cache, transactional rewards, retry and archive', { timeout: 45000 }, async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const namespace = `game-test-${suffix}`;
  const databaseName = `game_infrastructure_${suffix}`;
  const postgresUrl = process.env.TEST_POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const mongoUrl = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const previous = { POSTGRES_URL: process.env.POSTGRES_URL, MONGO_URL: process.env.MONGO_URL, MONGO_DB: process.env.MONGO_DB, REDIS_URL: process.env.REDIS_URL, REDIS_NAMESPACE: process.env.REDIS_NAMESPACE };
  const admin = new Pool({ connectionString: postgresUrl });
  const mongo = new MongoClient(mongoUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  let app: INestApplication | undefined;
  let socket: Socket | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const isolated = new URL(postgresUrl); isolated.pathname = '/' + databaseName;
    Object.assign(process.env, { POSTGRES_URL: isolated.toString(), MONGO_URL: mongoUrl, MONGO_DB: databaseName, REDIS_URL: redisUrl, REDIS_NAMESPACE: namespace });
    await mongo.connect();
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ValidationFilter());
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const request = async <T>(path: string, body?: object, status = body ? 201 : 200): Promise<T> => {
      const response = await fetch(`${origin}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result as T;
    };

    assert.equal((await request<Character[]>('/characters')).length, 10);
    assert.equal((await request<Content>('/content')).skills.length, 30);
    assert.equal((await request<object[]>('/skills')).length, 30);
    assert.equal((await request<object[]>('/items')).length, 1);
    await request('/battles/not-a-uuid', undefined, 400);
    const character = await request<Character>('/characters', { name: 'Интеграционный герой' });
    assert.equal((await request<Character>(`/characters/${character.id}`)).id, character.id);
    assert.equal((await request<object[]>(`/characters/${character.id}/inventory`)).length, 1);
    const learned = await request<Character>(`/characters/${character.id}/skills`, { skillId: 'ember' });
    assert.ok(learned.learnedSkillIds.includes('ember'));
    await request(`/characters/${character.id}/skills`, { skillId: 'ember' }, 400);

    const cache = app.get(Cache);
    await cache.set('integration', { answer: 42 }, 1);
    assert.deepEqual(await cache.get('integration'), { answer: 42 });
    await cache.delete('integration');
    assert.equal(await cache.get('integration'), null);
    await redis.set(`${namespace}:cache:corrupt`, 'invalid JSON');
    assert.equal(await cache.get('corrupt'), null);
    await cache.set('expires', { value: true }, 1);
    await eventually(async () => await cache.get('expires') === null, 3000);

    const room = await request<Battle>('/battles', { name: 'Интеграционный бой', characterId: character.id, kind: 'bot', rule: 'before' });
    const started = await request<Battle>(`/battles/${room.id}/start`, { characterId: character.id, version: room.version });
    const database = app.get(Database);
    // Test fixture: one legal move will finish the battle, without relying on random cascades.
    started.fighters.find(fighter => !fighter.npc)!.stats.attack = 10000;
    await database.sql.updateTable('battles').set({ data: JSON.stringify(started) }).where('id', '=', room.id).execute();

    socket = io(origin, { autoConnect: false, reconnection: false });
    const watched = new Promise<void>((resolve, reject) => {
      socket!.on('connect_error', reject);
      socket!.on('connect', () => socket!.emit('watch', room.id, (ack: { ok: boolean }) => { if (ack.ok) resolve(); else reject(new Error('Watch failed')); }));
    });
    socket.connect();
    await watched;
    const snapshots: Battle[] = [];
    socket.on('battle', value => snapshots.push(value));
    const action = { type: 'swap', ...possibleMove(started.board)!, targetId: started.fighters.find(fighter => fighter.npc)!.id };
    const result = await request<Battle>(`/battles/${room.id}/actions`, { characterId: character.id, version: started.version, action });
    assert.equal(result.status, 'finished');
    await request(`/battles/${room.id}/actions`, { characterId: character.id, version: started.version, action }, 409);
    assert.equal((await request<Character>(`/characters/${character.id}`)).level, 2);
    assert.equal((await database.sql.selectFrom('battle_rewards').selectAll().execute()).length, 1);
    await eventually(async () => snapshots.some(value => value.id === room.id && value.version === result.version));

    const archives = mongo.db(databaseName).collection('battleArchives');
    await eventually(async () => await archives.countDocuments({ id: room.id }) === 1);
    const archived = await archives.findOne({ id: room.id }, { projection: { _id: 0 } });
    assert.deepEqual(archived, result);
    const outbox = await database.sql.selectFrom('battle_archive_outbox').selectAll().where('id', '=', room.id).executeTakeFirstOrThrow();
    await eventually(async () => (await database.sql.selectFrom('battle_archive_outbox').select('delivered_at').where('id', '=', room.id).executeTakeFirst())?.delivered_at != null);
    assert.deepEqual(outbox.data, result);
    // MongoDB idempotency also protects a replay after BullMQ's completed job retention expires.
    await app.get(BattleHistoryRepository).archive(result);
    assert.equal(await archives.countDocuments({ id: room.id }), 1);

    let attempts = 0;
    const tasks = app.get(TaskQueue);
    tasks.consume<{ value: number }>('integration-retry', async data => {
      assert.equal(data.value, 42);
      if (++attempts === 1) throw new Error('Transient archive failure');
    });
    await tasks.enqueue('integration-retry', suffix, { value: 42 });
    await eventually(async () => attempts === 2);

    const beforeUnwatch = snapshots.length;
    await new Promise<void>(resolve => socket!.emit('unwatch', () => resolve()));
    socket.disconnect();
    assert.equal(snapshots.length, beforeUnwatch);
    // All connections and dispatchers must close cleanly, with no dangling workers.
    await app.close();
    app = undefined;
  } finally {
    socket?.disconnect();
    await app?.close();
    await mongo.db(databaseName).dropDatabase();
    await mongo.close();
    const keys = await redis.keys(`${namespace}:*`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('unavailable Redis does not block cache reads, enqueue retries or shutdown', { timeout: 15000 }, async () => {
  const previous = { REDIS_URL: process.env.REDIS_URL, REDIS_NAMESPACE: process.env.REDIS_NAMESPACE };
  const namespace = `game-offline-${randomUUID()}`;
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.REDIS_NAMESPACE = namespace;
  const tasks = new BullMqTaskQueue();
  const cache = new RedisCache();
  try {
    await cache.onModuleInit();
    assert.equal(await cache.get('missing'), null);
    await cache.set('optional', { value: true }, 30);
    tasks.consume('offline-worker', async () => undefined);
    const started = Date.now();
    await assert.rejects(tasks.enqueue('recovery', 'event', { value: 42 }));
    assert.ok(Date.now() - started < 5000, 'Unavailable producers must fail promptly');
    // The outbox can retry using a fresh producer when the endpoint becomes available.
    process.env.REDIS_URL = redisUrl;
    let delivered = false;
    tasks.consume<{ value: number }>('recovery', async data => { delivered = data.value === 42; });
    await tasks.enqueue('recovery', 'event', { value: 42 });
    await eventually(async () => delivered);
  } finally {
    cache.onApplicationShutdown();
    await tasks.beforeApplicationShutdown();
    const keys = await redis.keys(`${namespace}:*`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
