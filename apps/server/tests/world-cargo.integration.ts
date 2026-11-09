import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { removeTestQueues } from '@game/messaging/testing';
import { canonicalJson, writeWorldBlock, type Account, type AccountLogin, type Character, type WorldView, type CargoOffer, type CargoImportProof, type WorldCargoManifest } from '@game/core';
import { AppModule } from '../src/app.module';
import { ValidationFilter } from '../src/shared/http/validation.filter';
import { Database } from '../src/infrastructure/database/database.service';
import { MessageBus } from '../src/shared/application/message-bus';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { WorldCargoService } from '../src/modules/world-cargo/application/world-cargo.service';
import { WorldAppModule } from '../../world/src/app.module';
import { WorldRepository } from '../../world/src/modules/expeditions/ports/world.repository';
import { WorldDatabase } from '../../world/src/infrastructure/database/world-database';
import { UnitOfWork as WorldTransactions } from '../../world/src/shared/application/unit-of-work';
import { MessageBus as WorldMessageBus } from '../../world/src/shared/application/message-bus';
import { WorldCargoService as CargoExporter } from '../../world/src/modules/expeditions/application/world-cargo.service';
import { ValidationFilter as WorldValidationFilter } from '../../world/src/shared/http/validation.filter';

test('sealed world cargo reaches canonical inventory once through durable RabbitMQ offers and acknowledgements', { timeout: 120000 }, async t => {
  const suffix = randomUUID().replaceAll('-', ''), databaseName = `game_cargo_${suffix}`, mongoName = databaseName, namespace = `cargo-${suffix}`;
  const adminUrl = process.env.TEST_POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const mongoUrl = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017', redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const rabbitUrl = process.env.TEST_RABBITMQ_URL ?? 'amqp://game:game@127.0.0.1:5672', rabbitNamespace = `test-cargo-${suffix}`;
  const previous = Object.fromEntries(['POSTGRES_URL', 'MONGO_URL', 'MONGO_DB', 'REDIS_URL', 'REDIS_NAMESPACE', 'WORLD_POSTGRES_URL', 'WORLD_SERVICE_TOKEN', 'WORLD_URL', 'RABBITMQ_URL', 'RABBITMQ_NAMESPACE'].map(key => [key, process.env[key]]));
  const isolated = new URL(adminUrl); isolated.pathname = '/' + databaseName;
  const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 }), owner = new Pool({ connectionString: isolated.toString() });
  let main: INestApplication | undefined, world: INestApplication | undefined, created = false, mainUrl = '';
  async function start() {
    main = await NestFactory.create(AppModule, { logger: false }); main.setGlobalPrefix('api/v1'); main.useGlobalFilters(new ValidationFilter());
    await main.listen(0, '127.0.0.1'); mainUrl = `http://127.0.0.1:${main.getHttpServer().address().port}/api/v1`;
    world = await NestFactory.create(WorldAppModule, { logger: false }); world.setGlobalPrefix('api/v1'); world.useGlobalFilters(new WorldValidationFilter());
    await world.listen(0, '127.0.0.1'); process.env.WORLD_URL = `http://127.0.0.1:${world.getHttpServer().address().port}`;
  }
  async function call<T>(token: string, path: string, body?: unknown, expected = body === undefined ? 200 : 201, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const response = await fetch(mainUrl + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value as T;
  }
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.fail('durable delivery did not settle');
  }
  let token = '', hero: Character, otherToken = '', otherHero: Character, shovel = '';
  type Document = WorldCargoManifest & { status: 'available' | 'imported'; reason?: string };
  const docs = () => call<Document[]>(token, `/world/cargo?characterId=${hero.id}`);
  const quantity = async () => (await main!.get(InventoryService).get(hero.id)).items.filter(item => item.itemId === 'peat').reduce((sum, item) => sum + item.quantity, 0);
  const offer = async (id: string): Promise<CargoOffer> => (await world!.get(WorldDatabase).sql.selectFrom('cargo_outbox').select('data').where('manifest_id', '=', id).executeTakeFirstOrThrow()).data;
  async function ship() {
    const worldId = randomUUID(), path = `/world/expeditions/${worldId}`;
    await call(token, '/world/expeditions', { worldId, operationId: randomUUID() });
    await call(token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: 0, action: { type: 'enter' } });
    const position = await world!.get(WorldTransactions).run(async context => {
      const repository = world!.get(WorldRepository), record = (await repository.load(worldId, context))!;
      const position = { ...record.state.location!.position!, y: record.state.location!.position!.y - 1 };
      const region = record.state.regions.find(entry => entry.cellId === record.state.location!.cellId)!;
      writeWorldBlock(region, position, 'soil'); region.revision++;
      const revision = record.state.revision++; await repository.save(record.state, revision, context); return position;
    });
    let view = await call<WorldView>(token, path);
    await call(token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: view.revision, action: { type: 'harvest', position, toolInstanceId: shovel } });
    view = await call<WorldView>(token, path); assert.equal(view.xp >= 1, true); assert.deepEqual(view.cargo, [{ itemId: 'peat', quantity: 1 }]);
    await call(token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: view.revision, action: { type: 'close' } });
    const manifests = await call<WorldCargoManifest[]>(token, `${path}/manifests?characterId=${hero.id}`);
    assert.equal(manifests.length, 1);
    assert.equal((await world!.get(WorldDatabase).sql.selectFrom('geometry').selectAll().where('world_id', '=', worldId).execute()).length, 0);
    return manifests[0];
  }
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    Object.assign(process.env, { POSTGRES_URL: isolated.toString(), WORLD_POSTGRES_URL: isolated.toString(), MONGO_URL: mongoUrl, MONGO_DB: mongoName,
      REDIS_URL: redisUrl, REDIS_NAMESPACE: namespace, WORLD_SERVICE_TOKEN: randomBytes(32).toString('hex'), WORLD_URL: '', RABBITMQ_URL: rabbitUrl, RABBITMQ_NAMESPACE: rabbitNamespace });
    await start();
    const actors = [];
    for (const name of ['Добытчик', 'Посторонний']) {
      const account = await call<Account>('', '/accounts', { name: `${name} ${suffix.slice(0, 8)}` });
      const login = await call<AccountLogin>('', '/identity/session', { accountId: account.id });
      const character = await call<Character>(login.token, '/characters', { name });
      await call(login.token, '/identity/session/character', { characterId: character.id }); actors.push({ token: login.token, character });
    }
    token = actors[0].token; hero = actors[0].character; otherToken = actors[1].token; otherHero = actors[1].character;
    shovel = (await main!.get(InventoryService).receive(hero.id, 'digging-shovel', 1, randomUUID())).itemIds[0];
    let first: WorldCargoManifest, proof: CargoImportProof;
    await t.test('full backpack leaves the immutable cargo claimable; SQL failure rolls back items, projections and receipts', async () => {
      const state = await main!.get(InventoryService).get(hero.id), primary = state.inventories.find(entry => entry.primary)!;
      assert.equal(await quantity(), 0);
      const free = primary.capacity - state.items.filter(item => item.inventoryId === primary.id && !item.equippedSlot).length;
      const fillers = await main!.get(InventoryService).receive(hero.id, 'woodcutting-axe', free, randomUUID());
      first = await ship();
      await until(async () => { await world!.get(CargoExporter).flush(); return (await docs())[0]?.status === 'available'; });
      assert.equal(await quantity(), 0); assert.ok((await docs())[0].reason);
      await call(otherToken, `/world/cargo?characterId=${hero.id}`, undefined, 403);
      await call(otherToken, `/world/cargo/${first.id}/claim`, { operationId: randomUUID(), characterId: otherHero.id }, 403);
      await call(token, `/world/cargo/${first.id}/claim`, { operationId: randomUUID(), characterId: hero.id, cargo: [] }, 400);
      const claim = { operationId: randomUUID(), characterId: hero.id };
      await call(token, `/world/cargo/${first.id}/claim`, claim, 409);
      await call(token, `/item-instances/${fillers.itemIds[0]}`, { operationId: randomUUID(), quantity: 1 }, 200, 'DELETE');
      const before = await main!.get(Database).sql.selectFrom('characters').select('data').where('id', '=', hero.id).executeTakeFirstOrThrow();
      await owner.query(`CREATE FUNCTION fail_cargo_ack() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected ack failure''; END'`);
      await owner.query(`CREATE TRIGGER fail_cargo_ack BEFORE INSERT ON world_cargo_ack_outbox FOR EACH ROW EXECUTE FUNCTION fail_cargo_ack()`);
      await call(token, `/world/cargo/${first.id}/claim`, claim, 500);
      assert.equal(await quantity(), 0);
      assert.deepEqual((await main!.get(Database).sql.selectFrom('characters').select('data').where('id', '=', hero.id).executeTakeFirstOrThrow()).data, before.data);
      assert.equal((await docs())[0].status, 'available');
      assert.equal((await main!.get(Database).sql.selectFrom('world_cargo_operations').select('result').where('operation_id', '=', claim.operationId).executeTakeFirstOrThrow()).result, null);
      assert.equal((await main!.get(Database).sql.selectFrom('world_cargo_ack_outbox').selectAll().execute()).length, 0);
      await owner.query('DROP TRIGGER fail_cargo_ack ON world_cargo_ack_outbox');
      const replies = await Promise.all([claim, claim, { ...claim, operationId: randomUUID() }].map(command => call<CargoImportProof>(token, `/world/cargo/${first.id}/claim`, command)));
      proof = replies[0]; assert.ok(replies.every(reply => canonicalJson(reply) === canonicalJson(proof))); assert.equal(await quantity(), 1);
      const character = (await main!.get(Database).sql.selectFrom('characters').select('data').where('id', '=', hero.id).executeTakeFirstOrThrow()).data;
      assert.equal(character.inventory.find(item => item.itemId === 'peat')?.quantity, 1);
      await until(async () => { await main!.get(WorldCargoService).flush(); return (await world!.get(WorldDatabase).sql.selectFrom('cargo_outbox').select('result').where('manifest_id', '=', first.id).executeTakeFirstOrThrow()).result?.status === 'imported'; });
    });
    await t.test('duplicate and changed offers cannot mint more items or replace the original proof', async () => {
      const original = await offer(first!.id), bus = world!.get(WorldMessageBus);
      const send = (payload: CargoOffer) => bus.request('server', 'inventory.import-expedition-cargo', `${original.manifest.id}:offer`, payload);
      assert.deepEqual(await send(original), proof!); assert.deepEqual(await send(original), proof!);
      await assert.rejects(send({ ...original, hash: '0'.repeat(64) }), /Хэш/);
      const changed = { ...original.manifest, cargo: [{ itemId: 'peat', quantity: 99 }] };
      await assert.rejects(send({ manifest: changed, hash: createHash('sha256').update(canonicalJson(changed)).digest('hex') }), /другим содержимым/);
      assert.equal(await quantity(), 1);
    });
    await t.test('lost import reply and unavailable acknowledgement survive application restart and loss of test broker queues', async () => {
      const worldBus = world!.get(WorldMessageBus), mainBus = main!.get(MessageBus);
      const deliver = worldBus.request.bind(worldBus), acknowledge = mainBus.request.bind(mainBus);
      let allowOffer = false;
      worldBus.request = async (...args) => {
        if (args[1] !== 'inventory.import-expedition-cargo') return deliver(...args);
        if (!allowOffer) throw new Error('offer link unavailable');
        await deliver(...args); allowOffer = false; throw new Error('lost import reply after commit');
      };
      mainBus.request = async (...args) => { if (args[1] === 'inventory.cargo-imported') throw new Error('ack link unavailable'); return acknowledge(...args); };
      const second = await ship(); allowOffer = true;
      // Previous dispatch may have recorded a short retry delay; its durable offer remains in PostgreSQL.
      await until(async () => { await world!.get(CargoExporter).flush(); return (await docs()).find(entry => entry.id === second.id)?.status === 'imported'; });
      assert.equal(await quantity(), 2);
      const pending = await world!.get(WorldDatabase).sql.selectFrom('cargo_outbox').selectAll().where('manifest_id', '=', second.id).executeTakeFirstOrThrow();
      assert.equal(pending.delivered_at, null); assert.equal(pending.result, null);
      await main!.get(WorldCargoService).flush();
      const before = (await docs()).find(entry => entry.id === second.id)!;
      await main!.close(); main = undefined; await world!.close(); world = undefined;
      await removeTestQueues(rabbitUrl, rabbitNamespace); // Isolated test namespace only; the application journals survive.
      await start();
      await until(async () => { await main!.get(WorldCargoService).flush(); await world!.get(CargoExporter).flush();
        return (await world!.get(WorldDatabase).sql.selectFrom('cargo_outbox').select('result').where('manifest_id', '=', second.id).executeTakeFirstOrThrow()).result?.status === 'imported'; });
      assert.deepEqual((await docs()).find(entry => entry.id === second.id), before); assert.equal(await quantity(), 2);
      const original = await offer(second.id);
      const recovered = await world!.get(WorldMessageBus).request('server', 'inventory.import-expedition-cargo', `${second.id}:offer`, original) as CargoImportProof;
      assert.equal(recovered.status, 'imported'); assert.equal(await quantity(), 2);
      await world!.close(); world = undefined;
      assert.equal((await docs()).filter(entry => entry.status === 'imported').length, 2);
      assert.deepEqual(await call(token, `/world/cargo/${second.id}/claim`, { operationId: randomUUID(), characterId: hero.id }), recovered);
      assert.equal(await quantity(), 2);
    });
  } finally {
    if (main) await main.close(); if (world) await world.close();
    await removeTestQueues(rabbitUrl, rabbitNamespace); await owner.end();
    const mongo = new MongoClient(mongoUrl); try { await mongo.connect(); await mongo.db(mongoName).dropDatabase(); } finally { await mongo.close(); }
    const redis = new Redis(redisUrl); try { const keys = await redis.keys(`${namespace}:*`); if (keys.length) await redis.del(...keys); } finally { redis.disconnect(); }
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); await admin.end();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
