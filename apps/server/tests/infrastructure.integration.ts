import { CraftingOperationsRepository } from '../src/modules/crafting/ports/crafting-operations.repository';
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
import { Battle, Character, Content, InventoryView, InventoryResult, findBattlefieldMove, findBattlefieldMatches, gainExperience, seedContent, seedEffectSkills, skillChoices } from '@game/core';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { InventoryRepository } from '../src/modules/inventory/ports/inventory.repository';
import { AppModule } from '../src/app.module';
import { Database } from '../src/infrastructure/database/database.service';
import { Cache } from '../src/shared/application/cache.port';
import { TaskQueue } from '../src/shared/application/task-queue.port';
import { BattleHistoryRepository } from '../src/modules/battle-history/ports/battle-history.repository';
import { ValidationFilter } from '../src/shared/http/validation.filter';
import { BullMqTaskQueue } from '../src/infrastructure/queues/bullmq-task-queue';
import { RedisCache } from '../src/infrastructure/redis/redis-cache';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { UnitOfWork } from '../src/shared/application/unit-of-work';
import { MongoDatabase } from '../src/infrastructure/mongo/mongo.service';
import { BattlesRepository } from '../src/modules/battles/ports/battles.repository';

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
    // Upgrade an existing customized Mongo catalog rather than only testing a fresh seed.
    const oldBalance = structuredClone(seedContent.balance);
    delete oldBalance.combat; oldBalance.progression.startingSkillPoints = 2;
    oldBalance.progression.statGrowth.maxEnergy = 2; oldBalance.teamSize = 2;
    await mongo.db(databaseName).collection('settings').insertOne({ id: 'balance', ...oldBalance });
    const oldStrike = structuredClone(seedContent.skills.find(skill => skill.id === 'strike')!); oldStrike.cost = 0;
    const oldInferno = structuredClone(seedContent.skills.find(skill => skill.id === 'inferno')!);
    oldInferno.learning.stats.maxEnergy = 36; oldInferno.power = 47;
    await mongo.db(databaseName).collection('skills').insertMany([oldStrike, oldInferno]);
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ValidationFilter());
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const request = async <T>(path: string, body?: object, status = body ? 201 : 200, method = body ? 'POST' : 'GET'): Promise<T> => {
      const response = await fetch(`${origin}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result as T;
    };

    assert.equal((await request<Character[]>('/characters')).length, 10);
    const catalog = await request<Content>('/content');
    assert.equal(catalog.skills.length, seedContent.skills.length + seedEffectSkills.length); assert.equal(catalog.balance.progression.startingSkillPoints, 4);
    assert.equal(catalog.balance.progression.statGrowth.maxEnergy, 0); assert.equal(catalog.balance.teamSize, 2);
    assert.equal(catalog.skills.find(skill => skill.id === 'strike')!.cost, 3);
    assert.equal(catalog.skills.find(skill => skill.id === 'inferno')!.learning.stats.maxEnergy, 30);
    assert.equal(catalog.skills.find(skill => skill.id === 'inferno')!.power, 47);
    assert.equal((await request<object[]>('/skills')).length, seedContent.skills.length + seedEffectSkills.length);
    assert.equal((await request<object[]>('/items')).length, seedContent.items.length);
    await request('/battles/not-a-uuid', undefined, 400);
    const character = await request<Character>('/characters', { name: 'Интеграционный герой' });
    assert.equal(character.skillPoints, 4); assert.deepEqual(character.learnedSkillIds, ['strike']);
    await verifyCharacterCreation(character, request, app);
    await verifyCharacterAttributes(request, app, catalog);
    await verifyRankedCrafting(request, app);
    await verifyBattleEffects(request, app);
    assert.equal((await request<Character>(`/characters/${character.id}`)).id, character.id);
    assert.equal((await request<object[]>(`/characters/${character.id}/inventory`)).length, character.inventory.length);
    const learned = await request<Character>(`/characters/${character.id}/skills`, { skillId: 'ember' });
    assert.ok(learned.learnedSkillIds.includes('ember'));
    await request(`/characters/${character.id}/skills`, { skillId: 'ember' }, 400);
    await verifyOperations(character, request, app);

    const cache = app.get(Cache);
    await cache.set('integration', { answer: 42 }, 1);
    assert.deepEqual(await cache.get('integration'), { answer: 42 });
    await cache.delete('integration');
    assert.equal(await cache.get('integration'), null);
    await redis.set(`${namespace}:cache:corrupt`, 'invalid JSON');
    assert.equal(await cache.get('corrupt'), null);
    await cache.set('expires', { value: true }, 1);
    await eventually(async () => await cache.get('expires') === null, 3000);

    for (const battlefield of [{ size: 2 }, { size: 33 }, { size: 6, elementTypes: [] }, { size: 6, elementTypes: ['fire', 'fire'] }, { size: 6, elementTypes: ['fire', 'invalid'] }]) {
      await request('/battles', { name: 'Неверное поле', characterId: character.id, kind: 'bot', rule: 'before', battlefield }, 400);
    }
    const defaults = await request<Battle>('/battles', { name: 'Поле по умолчанию', characterId: character.id, kind: 'bot', rule: 'before' });
    assert.deepEqual(defaults.battlefield?.size, { rows: 8, cols: 8 });
    assert.equal(defaults.battlefield?.elementTypes.length, 6);
    const room = await request<Battle>('/battles', { name: 'Интеграционный бой', characterId: character.id, kind: 'bot', rule: 'before', battlefield: { size: { rows: 6, cols: 10 }, elementTypes: ['physical', 'water', 'defense'] } });
    assert.deepEqual(room.battlefield?.size, { rows: 6, cols: 10 });
    assert.ok(room.board.flat().every(type => ['physical', 'water', 'defense'].includes(type)));
    const started = await request<Battle>(`/battles/${room.id}/start`, { characterId: character.id, version: room.version });
    assert.equal(started.fighters[0].skillLevels?.strike, 10);
    assert.equal(started.fighters[1].skillLevels?.strike, 10);
    const equipped = (await request<InventoryView>(`/characters/${character.id}/inventories`)).items.find(item => item.equippedSlot)!;
    const frozenAttack = started.fighters[0].stats.attack;
    await request(`/item-instances/${equipped.id}/actions`, { action: 'unequip', operationId: randomUUID() });
    assert.equal((await request<Battle>(`/battles/${room.id}`)).fighters[0].stats.attack, frozenAttack);
    const database = app.get(Database);
    // Test fixture: one legal move will finish the battle, without relying on random cascades.
    const strong = started.fighters.find(fighter => !fighter.npc)!;
    strong.stats.attack = 10000;
    if (strong.attributes) strong.attributes.effective.physicalPower = 10000;
    started.board = Array.from({ length: 6 }, (_, row) => Array.from({ length: 10 }, (_, col) => (row + col) % 2 ? 'water' : 'physical'));
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
    const action = { type: 'swap', from: { row: 1, col: 8 }, to: { row: 1, col: 9 }, targetId: started.fighters.find(fighter => fighter.npc)!.id };
    const moved = await request<Battle>(`/battles/${room.id}/actions`, { characterId: character.id, version: started.version, action });
    assert.equal(moved.status, 'active'); assert.equal(moved.phase, 'choose');
    assert.equal(moved.fighters[1].hp, started.fighters[1].hp);
    assert.deepEqual(moved.skillChoices?.map(choice => choice.skillId), ['strike']);
    const move = moved.boardMoves![0];
    assert.deepEqual(move.direct, { count: 6, byType: { physical: 3, water: 3, defense: 0 } });
    assert.equal(move.total.count, move.direct.count + move.generated.count);
    assert.equal(moved.board.length, 6);
    assert.ok(moved.board.every(row => row.length === 10));
    assert.deepEqual((await request<Battle>(`/battles/${room.id}`)).boardMoves, moved.boardMoves);
    assert.deepEqual((await request<Battle>(`/battles/${room.id}`)).playback, moved.playback);
    assert.equal(moved.playback?.[0].phase, 'choose');
    assert.ok(move.steps.every(step => step.cells?.length === step.removed.count && step.boardAfter?.length === 6));
    await request(`/battles/${room.id}/actions`, { characterId: character.id, version: started.version, action }, 409);
    const result = await request<Battle>(`/battles/${room.id}/actions`, { characterId: character.id, version: moved.version, action: { type: 'skill', skillId: 'strike', targetId: 'bot-opponent' } });
    assert.equal(result.status, 'finished');
    assert.equal(result.fighters[0].skillEnergy, moved.fighters[0].skillEnergy! - 3);
    assert.equal((await request<Character>(`/characters/${character.id}`)).level, 2);
    assert.equal((await request<Character>(`/characters/${character.id}`)).attributePoints, 5);
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

    const twoTypes = await request<Battle>('/battles', { name: 'Две стихии', characterId: character.id, kind: 'bot', rule: 'on-match', battlefield: { size: 8, elementTypes: ['physical', 'water'] } });
    const twoStarted = await request<Battle>(`/battles/${twoTypes.id}/start`, { characterId: character.id, version: twoTypes.version });
    twoStarted.board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row + col) % 2 ? 'water' : 'physical'));
    await database.sql.updateTable('battles').set({ data: JSON.stringify(twoStarted) }).where('id', '=', twoStarted.id).execute();
    const twoMove = { from: { row: 1, col: 6 }, to: { row: 1, col: 7 } };
    const settled = await request<Battle>(`/battles/${twoTypes.id}/actions`, { characterId: character.id, version: twoStarted.version, action: { type: 'swap', ...twoMove, targetId: 'bot-opponent' } });
    assert.equal(settled.phase, 'choose');
    assert.equal(findBattlefieldMatches(settled.board).length, 0);
    assert.ok(findBattlefieldMove(settled.board));
    assert.ok(settled.board.flat().every(type => ['physical', 'water'].includes(type)));
    assert.equal(settled.boardMoves![0].total.count, settled.boardMoves![0].direct.count + settled.boardMoves![0].generated.count);
    assert.equal(settled.boardMoves![0].shuffled, settled.boardMoves![0].regeneration !== null);

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

type TestRequest = <T>(path: string, body?: object, status?: number, method?: string) => Promise<T>;
async function verifyCharacterCreation(character: Character, request: TestRequest, app: INestApplication) {
  const database = app.get(Database);
  // Inspect storage before the first inventory GET: creation must already have persisted everything.
  const containers = await database.sql.selectFrom('inventories').selectAll().where('owner_id', '=', character.id).execute();
  assert.equal(containers.length, 1);
  assert.equal(containers[0].is_primary, true);
  assert.equal(containers[0].capacity, 50);
  const items = await database.sql.selectFrom('item_instances').selectAll().where('owner_id', '=', character.id).execute();
  assert.ok(items.every(item => item.inventory_id === containers[0].id));
  const totals = (rows: typeof items) => Object.fromEntries(character.inventory.map(stack => [stack.itemId, rows.filter(item => item.item_id === stack.itemId).reduce((sum, item) => sum + item.quantity, 0)]));
  assert.deepEqual(totals(items), Object.fromEntries(character.inventory.map(stack => [stack.itemId, stack.quantity])));
  const views = await Promise.all([0, 1].map(() => request<InventoryView>(`/characters/${character.id}/inventories`)));
  for (const view of views) assert.deepEqual(view.items.map(item => item.id).sort(), items.map(item => item.id).sort());

  const before = {
    characters: (await database.sql.selectFrom('characters').select('id').execute()).length,
    containers: (await database.sql.selectFrom('inventories').select('id').execute()).length,
    items: (await database.sql.selectFrom('item_instances').select('id').execute()).length,
  };
  const repository = app.get(InventoryRepository), ensurePrimary = repository.ensurePrimary;
  repository.ensurePrimary = async (...args) => {
    await ensurePrimary.apply(repository, args);
    throw new Error('simulated starting inventory persistence failure');
  };
  try { await request('/characters', { name: 'Откат создания' }, 500); }
  finally { repository.ensurePrimary = ensurePrimary; }
  assert.equal((await database.sql.selectFrom('characters').select('id').execute()).length, before.characters);
  assert.equal((await database.sql.selectFrom('inventories').select('id').execute()).length, before.containers);
  assert.equal((await database.sql.selectFrom('item_instances').select('id').execute()).length, before.items);
  const retry = await request<Character>('/characters', { name: 'Откат создания' });
  assert.equal((await database.sql.selectFrom('inventories').select('id').where('owner_id', '=', retry.id).execute()).length, 1);
}

async function verifyOperations(character: Character, request: TestRequest, app: INestApplication) {
  const owner = character.id;
  const view = () => request<InventoryView>(`/characters/${owner}/inventories`);
  const action = (instanceId: string, data: object, operationId = randomUUID(), status = 201) => request<InventoryResult>(`/item-instances/${instanceId}/actions`, { ...data, operationId }, status);
  const transfer = (instanceId: string, targetInventoryId: string, quantity: number, operationId = randomUUID(), status = 201) => request<InventoryResult>('/inventory-transfers', { instanceId, targetInventoryId, quantity, operationId }, status);
  assert.equal((await request<object[]>('/items/groups')).length, 5);
  const initial = await view();
  const ore = initial.items.find(item => item.itemId === 'iron-ore')!;
  const sword = initial.items.find(item => item.itemId === 'iron-sword')!;
  const scroll = initial.items.find(item => item.itemId === 'ember-scroll')!;
  assert.equal((await request<{ definition: { groupId: string } }>(`/item-instances/${sword.id}`)).definition.groupId, 'weapons');

  const createId = randomUUID();
  const body = { name: 'Сундук', capacity: 1, operationId: createId };
  const chest = await request<InventoryResult>(`/characters/${owner}/inventories`, body);
  assert.deepEqual(await request(`/characters/${owner}/inventories`, body), chest);
  assert.equal((await view()).inventories.length, 2);
  const split = await action(ore.id, { action: 'split', quantity: 3 });
  const part = split.itemIds.find(id => id !== ore.id)!;
  const mergeId = randomUUID();
  const merged = await action(part, { action: 'merge', targetInstanceId: ore.id }, mergeId);
  assert.deepEqual(await action(part, { action: 'merge', targetInstanceId: ore.id }, mergeId), merged);
  assert.equal((await view()).items.find(item => item.id === ore.id)?.quantity, seedContent.balance.starterItems.find(stack => stack.itemId === 'iron-ore')!.quantity);
  await action(ore.id, { action: 'split', quantity: 1 }, mergeId, 409);

  const detached = await action(ore.id, { action: 'remove', quantity: 2 });
  const detachedId = detached.itemIds[0];
  assert.equal((await view()).items.find(item => item.id === detachedId)?.inventoryId, null);
  await request(`/inventories/${chest.inventoryId}/items`, { instanceId: detachedId, quantity: 2, operationId: randomUUID() });
  await transfer(sword.id, chest.inventoryId!, 1, randomUUID(), 400);
  assert.equal((await view()).items.find(item => item.id === sword.id)?.inventoryId, owner);

  const recipient = await request<Character>('/characters', { name: 'Получатель' });
  const recipientView = () => request<InventoryView>(`/characters/${recipient.id}/inventories`);
  await action(sword.id, { action: 'equip' });
  assert.equal((await request<Character>(`/characters/${owner}`)).equipmentBonuses?.attack, 4);
  await transfer(sword.id, recipient.id, 1, randomUUID(), 400);
  await action(sword.id, { action: 'unequip' });
  await transfer(ore.id, recipient.id, 5);
  const sum = (state: InventoryView) => state.items.filter(item => item.itemId === 'iron-ore').reduce((total, item) => total + item.quantity, 0);
  assert.equal(sum(await view()) + sum(await recipientView()), 2 * seedContent.balance.starterItems.find(stack => stack.itemId === 'iron-ore')!.quantity);

  const removeId = randomUUID();
  const removeBody = { quantity: 1, operationId: removeId };
  const deletion = await request<InventoryResult>(`/item-instances/${ore.id}`, removeBody, 200, 'DELETE');
  assert.deepEqual(await request(`/item-instances/${ore.id}`, removeBody, 200, 'DELETE'), deletion);
  assert.equal(sum(await view()) + sum(await recipientView()), 2 * seedContent.balance.starterItems.find(stack => stack.itemId === 'iron-ore')!.quantity - 1);

  await action(scroll.id, { action: 'read' }, randomUUID(), 400);
  assert.ok((await view()).items.some(item => item.id === scroll.id));
  const recipientScroll = (await recipientView()).items.find(item => item.itemId === 'ember-scroll')!;
  const readId = randomUUID();
  const read = await action(recipientScroll.id, { action: 'read' }, readId);
  assert.deepEqual(await action(recipientScroll.id, { action: 'read' }, readId), read);
  const granted = await request<Character>(`/characters/${recipient.id}`);
  assert.equal(granted.skillLevels?.ember, 1); assert.equal(granted.skillPoints, recipient.skillPoints);
  const inventory = app.get(InventoryService);
  const receiveId = randomUUID();
  const [received, duplicate] = await Promise.all([
    inventory.receive(recipient.id, 'ember-scroll', 1, receiveId),
    inventory.receive(recipient.id, 'ember-scroll', 1, receiveId),
  ]);
  assert.deepEqual(duplicate, received);
  const gift = (await recipientView()).items.find(item => item.id === received.itemIds[0])!;
  await action(gift.id, { action: 'read' }, randomUUID(), 400);
  assert.equal((await recipientView()).items.find(item => item.id === gift.id)?.quantity, 1);

  // A persistence failure after granting the skill must roll back both the grant and the consumable.
  const rollbackHero = await request<Character>('/characters', { name: 'Откат свитка' });
  const rollbackView = () => request<InventoryView>(`/characters/${rollbackHero.id}/inventories`);
  const rollbackScroll = (await rollbackView()).items.find(item => item.itemId === 'ember-scroll')!;
  const repository = app.get(InventoryRepository), save = repository.save;
  repository.save = async () => { throw new Error('simulated inventory persistence failure'); };
  const rollbackId = randomUUID();
  try { await action(rollbackScroll.id, { action: 'read' }, rollbackId, 500); }
  finally { repository.save = save; }
  assert.ok(!(await request<Character>(`/characters/${rollbackHero.id}`)).learnedSkillIds.includes('ember'));
  assert.ok((await rollbackView()).items.some(item => item.id === rollbackScroll.id));
  await action(rollbackScroll.id, { action: 'read' }, rollbackId);
  assert.ok((await request<Character>(`/characters/${rollbackHero.id}`)).learnedSkillIds.includes('ember'));

  const race = await Promise.allSettled([
    request(`/characters/${owner}/skills/strike/upgrade`, { expectedLevel: 1 }),
    request(`/characters/${owner}/skills/strike/upgrade`, { expectedLevel: 1 }),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const conflict = race.find(result => result.status === 'rejected');
  assert.equal(conflict?.status === 'rejected' ? conflict.reason.actual : undefined, 409);
  const database = app.get(Database);
  const current = await request<Character>(`/characters/${owner}`);
  current.skillPoints = 20;
  await database.sql.updateTable('characters').set({ data: JSON.stringify(current) }).where('id', '=', owner).execute();
  for (let level = 2; level < 10; level++) await request(`/characters/${owner}/skills/strike/upgrade`, { expectedLevel: level });
  await request(`/characters/${owner}/skills/strike/upgrade`, { expectedLevel: 10 }, 400);
  const ranked = await request<Character>(`/characters/${owner}`);
  assert.equal(ranked.skillLevels?.strike, 10); assert.equal(ranked.skillPoints, 12);
  assert.equal((await request<{ id: string; level: number }[]>(`/characters/${owner}/skills`)).find(skill => skill.id === 'strike')?.level, 10);
  await action(sword.id, { action: 'equip' });
  const equippedCharacter = await request<Character>(`/characters/${owner}`);
  assert.ok(!equippedCharacter.inventory.some(stack => stack.itemId === 'iron-sword'));
  const replacement = await inventory.receive(owner, 'iron-sword', 1, randomUUID());
  await action(replacement.itemIds[0], { action: 'equip' });
  const replaced = await view();
  assert.equal(replaced.items.find(item => item.id === sword.id)?.equippedSlot, null);
  assert.equal(replaced.items.find(item => item.id === replacement.itemIds[0])?.equippedSlot, 'main-hand');
  const afterReplacement = await request<Character>(`/characters/${owner}`);
  assert.equal(afterReplacement.equipmentBonuses?.attack, 4);
  assert.equal(afterReplacement.inventory.find(stack => stack.itemId === 'iron-sword')?.quantity, 1);
  // Swap both directions so correctness cannot depend on which random UUID sorts first.
  await action(sword.id, { action: 'equip' });
  const switchedBack = await view();
  assert.equal(switchedBack.items.find(item => item.id === sword.id)?.equippedSlot, 'main-hand');
  assert.equal(switchedBack.items.find(item => item.id === replacement.itemIds[0])?.equippedSlot, null);
}

async function verifyCharacterAttributes(request: TestRequest, app: INestApplication, content: Content) {
  const hero = await request<Character>('/characters', { name: 'Распределение очков' });
  assert.equal(hero.attributePoints, 0);
  assert.equal(hero.attributes?.base.physicalPower, 8);
  const service = app.get(CharactersService);
  const grown = await app.get(UnitOfWork).run(context => service.update(hero.id, content, character => {
    gainExperience(character, 100, content.balance.progression);
  }, context));
  assert.equal(grown.attributePoints, 5);
  assert.equal(grown.attributes?.base.physicalPower, 8);
  const allocate = (allocations: Record<string, number>, expectedRevision: number, status = 201) => request<Character>(`/characters/${hero.id}/attributes`, { allocations, expectedRevision }, status);
  const race = await Promise.allSettled([allocate({ strength: 3 }, grown.attributeRevision!), allocate({ intelligence: 3 }, grown.attributeRevision!)]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = race.find(result => result.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' ? rejected.reason.actual : undefined, 409);
  const current = await request<Character>(`/characters/${hero.id}`);
  assert.equal(current.attributePoints, 2);
  await allocate({ strength: 3 }, current.attributeRevision!, 400);
  await allocate({ strength: -1 }, current.attributeRevision!, 400);
  await allocate({ physicalPower: 1 }, current.attributeRevision!, 400);
  assert.equal((await request<Character>(`/characters/${hero.id}`)).attributePoints, 2);

  const item = { ...seedContent.items.find(item => item.id === 'iron-sword')!, id: 'attribute-test-sword', attributeRequirements: { vitality: 12 } };
  await app.get(MongoDatabase).db.collection('items').insertOne(item);
  const inventory = app.get(InventoryService);
  const received = await inventory.receive(hero.id, item.id, 1, randomUUID());
  const instanceId = received.itemIds[0];
  const blocked = (await inventory.get(hero.id)).items.find(item => item.id === instanceId)!.actions.find(action => action.id === 'equip')!;
  assert.equal(blocked.enabled, false); assert.match(blocked.reason!, /Выносливость 12/);
  await request(`/item-instances/${instanceId}/actions`, { action: 'equip', operationId: randomUUID() }, 400);
  const increased = await allocate({ vitality: 2 }, current.attributeRevision!);
  assert.equal(increased.attributePoints, 0);
  assert.equal(increased.attributes?.base.maxHp, 144);
  await request(`/item-instances/${instanceId}/actions`, { action: 'equip', operationId: randomUUID() });
  const equipped = await request<Character>(`/characters/${hero.id}`);
  assert.ok(equipped.attributes!.equipped.physicalPower > equipped.attributes!.base.physicalPower);
  assert.deepEqual(equipped.baseAttributes, increased.baseAttributes);
  const persisted = await app.get(Database).sql.selectFrom('characters').select('data').where('id', '=', hero.id).executeTakeFirstOrThrow();
  assert.equal(persisted.data.attributePoints, 0);
  assert.equal(persisted.data.baseAttributes?.vitality, 12);
}

async function verifyBattleEffects(request: TestRequest, app: INestApplication) {
  const first = await request<Character>('/characters', { name: 'Маг усилений' });
  const second = await request<Character>('/characters', { name: 'Маг ослаблений' });
  for (const id of ['battle-cry', 'weakening', 'purify']) await request(`/characters/${first.id}/skills`, { skillId: id });
  await request(`/characters/${second.id}/skills`, { skillId: 'weakening' });
  const created = await request<Battle>('/battles', { name: 'Проверка бафов', characterId: first.id, kind: 'duel' });
  const joined = await request<Battle>(`/battles/${created.id}/join`, { characterId: second.id, team: 1 });
  let battle = await request<Battle>(`/battles/${created.id}/start`, { characterId: first.id, version: joined.version });
  assert.equal(battle.effectsVersion, 1);
  const read = () => request<Battle>(`/battles/${battle.id}`);
  const database = app.get(Database);
  const prepare = async (skillId: string) => {
    battle = await read();
    const actor = battle.fighters.find(fighter => fighter.id === battle.activeId)!;
    actor.skillEnergy = 30; actor.cooldowns[skillId] = 0; battle.usedSkill = false;
    battle.phase = 'choose'; battle.matchedElements = [battle.content.skills.find(skill => skill.id === skillId)!.element];
    battle.skillChoices = skillChoices(battle, actor);
    await database.sql.updateTable('battles').set({ data: JSON.stringify(battle) }).where('id', '=', battle.id).execute();
  };
  const command = (action: object, characterId = battle.activeId!, version = battle.version, status = 201) => request<Battle>(`/battles/${battle.id}/actions`, { characterId, version, action }, status);
  const pass = async () => { await prepare('strike'); battle = await command({ type: 'end' }); };
  await prepare('battle-cry');
  const before = await read();
  const repository = app.get(BattlesRepository), save = repository.save;
  repository.save = async () => { throw new Error('simulated effect save failure'); };
  try { await command({ type: 'skill', skillId: 'battle-cry', targetId: first.id }, first.id, battle.version, 500); }
  finally { repository.save = save; }
  assert.deepEqual(await read(), before);
  const version = battle.version;
  battle = await command({ type: 'skill', skillId: 'battle-cry', targetId: first.id });
  let caster = battle.fighters.find(fighter => fighter.id === first.id)!;
  assert.equal(caster.activeEffects?.length, 1);
  assert.equal(caster.activeEffects![0].remainingTurns, 2);
  assert.equal(caster.attributes!.effective.strength, 12);
  assert.equal(caster.skillEnergy, 27);
  assert.ok(battle.playback?.some(frame => frame.fighters.some(fighter => fighter.activeEffects?.length)));
  await command({ type: 'skill', skillId: 'battle-cry', targetId: first.id }, first.id, version, 409);
  assert.equal((await read()).effectSequence, battle.effectSequence);
  const stored = await database.sql.selectFrom('battles').select('data').where('id', '=', battle.id).executeTakeFirstOrThrow();
  assert.deepEqual(stored.data.fighters.find(fighter => fighter.id === first.id)!.activeEffects, caster.activeEffects);
  assert.equal((await request<Character>(`/characters/${first.id}`)).baseAttributes!.strength, 10);
  assert.equal((await request<Character>(`/characters/${first.id}`)).attributes!.effective.strength, 10);

  await prepare('weakening');
  battle = await command({ type: 'skill', skillId: 'weakening', targetId: first.id });
  caster = battle.fighters.find(fighter => fighter.id === first.id)!;
  assert.equal(caster.activeEffects!.length, 2);
  assert.ok(caster.attributes!.effective.physicalPower < caster.attributes!.equipped.physicalPower + 1);
  await prepare('purify');
  await command({ type: 'skill', skillId: 'purify', targetId: second.id }, first.id, battle.version, 400);
  battle = await command({ type: 'skill', skillId: 'purify', targetId: first.id });
  caster = battle.fighters.find(fighter => fighter.id === first.id)!;
  assert.equal(caster.activeEffects!.length, 1);
  assert.equal(caster.activeEffects![0].polarity, 'buff');
  assert.equal(caster.activeEffects![0].remainingTurns, 1);
  await pass(); await pass();
  caster = battle.fighters.find(fighter => fighter.id === first.id)!;
  assert.equal(caster.activeEffects!.length, 0);
  assert.equal(caster.attributes!.effective.strength, 10);
  assert.equal(caster.attributeState!.temporaryModifiers.length, 0);
}

async function verifyRankedCrafting(request: TestRequest, app: INestApplication) {
  const hero = await request<Character>('/characters', { name: 'Мастер крафта' });
  const inventory = app.get(InventoryService);
  await inventory.receive(hero.id, 'iron-ore', 150, randomUUID());
  const catalog = await request<{ recipes: { id: string; rankPreviews: unknown[] }[]; professions: { id: string; level: number; totalXp: number }[] }>(`/characters/${hero.id}/crafting`);
  assert.equal(catalog.professions.find(profession => profession.id === 'blacksmith')!.level, 1);
  assert.ok(catalog.recipes.find(recipe => recipe.id === 'craft-rare-sword')!.rankPreviews.length);
  const operationId = randomUUID();
  const craft = (id = operationId, status = 201) => request<InventoryResult>(`/characters/${hero.id}/crafting/recipes/craft-rare-sword/apply`, { operationId: id }, status);
  const [first, replay] = await Promise.all([craft(), craft()]);
  assert.deepEqual(replay, first);
  const item = first.createdItems![0];
  assert.equal(item.quality!.rank.id, 'rare'); assert.equal(item.quality!.affixes.length, 3);
  let view = await inventory.get(hero.id);
  assert.deepEqual(view.items.find(value => value.id === item.id)!.quality, item.quality);
  assert.equal((await request<Character>(`/characters/${hero.id}`)).craftingProfessionXp!.blacksmith, 10);
  const equipId = randomUUID();
  await request(`/item-instances/${item.id}/actions`, { action: 'equip', operationId: equipId });
  const equipped = await request<Character>(`/characters/${hero.id}`);
  assert.equal(equipped.equipmentModifiers!.filter(modifier => modifier.id.includes(':affix:')).length, 3);
  assert.ok(equipped.attributes!.effective.physicalPower > equipped.attributes!.base.physicalPower);
  await request(`/item-instances/${item.id}/actions`, { action: 'unequip', operationId: randomUUID() });
  view = await inventory.get(hero.id);
  assert.deepEqual(view.items.find(value => value.id === item.id)!.quality, item.quality);
  const recipient = await request<Character>('/characters', { name: 'Получатель допов' });
  await request('/inventory-transfers', { operationId: randomUUID(), instanceId: item.id, targetInventoryId: recipient.id, quantity: 1 });
  assert.deepEqual((await inventory.get(recipient.id)).items.find(value => value.id === item.id)!.quality, item.quality);

  const before = await inventory.get(hero.id);
  const repository = app.get(CraftingOperationsRepository), finish = repository.finishOperation;
  repository.finishOperation = async () => { throw new Error('simulated receipt failure'); };
  const retryId = randomUUID();
  try { await craft(retryId, 500); } finally { repository.finishOperation = finish; }
  assert.deepEqual(await inventory.get(hero.id), before);
  assert.equal((await request<Character>(`/characters/${hero.id}`)).craftingProfessionXp!.blacksmith, 10);
  await craft(retryId);
  assert.equal((await request<Character>(`/characters/${hero.id}`)).craftingProfessionXp!.blacksmith, 20);

  // Profile choice uses the level BEFORE this operation's experience award.
  const service = app.get(CharactersService);
  const content = await request<Content>('/content');
  await app.get(UnitOfWork).run(context => service.update(hero.id, content, character => { character.craftingProfessionXp = { blacksmith: 90 }; }, context));
  const normal = await request<InventoryResult>(`/characters/${hero.id}/crafting/recipes/craft-iron-sword/apply`, { operationId: randomUUID() });
  assert.ok(normal.createdItems![0].quality);
  const after = await request<{ professions: { id: string; level: number; totalXp: number }[] }>(`/characters/${hero.id}/crafting`);
  assert.equal(after.professions.find(profession => profession.id === 'blacksmith')!.level, 2);
  assert.equal(after.professions.find(profession => profession.id === 'blacksmith')!.totalXp, 100);
  // Mongo enforces the separate boolean applicability flags.
  await assert.rejects(app.get(MongoDatabase).db.collection('modifierDefinitions').insertOne({ id: 'invalid-flags', allowSkill: true, allowWeapon: 1, allowArmor: false }));
}
