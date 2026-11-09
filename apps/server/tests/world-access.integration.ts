import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { removeTestQueues } from '@game/messaging/testing';
import { writeWorldBlock, type Account, type AccountLogin, type Character, type PartyState, type WorldCommandResult, type WorldView, type InventoryView } from '@game/core';
import { AppModule } from '../src/app.module';
import { ValidationFilter } from '../src/shared/http/validation.filter';
import { Database } from '../src/infrastructure/database/database.service';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { WorldRemote } from '../src/modules/world-gateway/ports/world-remote';
import { WorldGatewayService } from '../src/modules/world-gateway/application/world-gateway.service';
import { WorldAppModule } from '../../world/src/app.module';
import { WorldRepository } from '../../world/src/modules/expeditions/ports/world.repository';
import { UnitOfWork as WorldTransactions } from '../../world/src/shared/application/unit-of-work';
import { ValidationFilter as WorldValidationFilter } from '../../world/src/shared/http/validation.filter';

test('main server admits world commands against current parties and canonical reserved inventory', { timeout: 120000 }, async t => {
  const suffix = randomUUID().replaceAll('-', ''), databaseName = `game_access_${suffix}`, mongoName = `game_access_${suffix}`, namespace = `access-${suffix}`;
  const adminUrl = process.env.TEST_POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const mongoUrl = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017', redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const rabbitUrl = process.env.TEST_RABBITMQ_URL ?? 'amqp://game:game@127.0.0.1:5672', rabbitNamespace = `test-access-${suffix}`;
  const previous = Object.fromEntries(['POSTGRES_URL', 'MONGO_URL', 'MONGO_DB', 'REDIS_URL', 'REDIS_NAMESPACE', 'WORLD_POSTGRES_URL', 'WORLD_SERVICE_TOKEN', 'WORLD_URL', 'RABBITMQ_URL', 'RABBITMQ_NAMESPACE'].map(key => [key, process.env[key]]));
  const isolated = new URL(adminUrl); isolated.pathname = '/' + databaseName;
  const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  let main: INestApplication | undefined, world: INestApplication | undefined, created = false;
  let mainUrl = '', worldUrl = '';
  async function mainApp() {
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ValidationFilter());
    try { await app.listen(0, '127.0.0.1'); mainUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`; return app; }
    catch (error) { await app.close(); throw error; }
  }
  async function call<T>(token: string, path: string, body?: unknown, expected = body === undefined ? 200 : 201, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const response = await fetch(mainUrl + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value as T;
  }
  const actors: { token: string; account: Account; hero: Character }[] = [];
  const worldId = randomUUID(), path = `/world/expeditions/${worldId}`;
  const state = (who = actors[0]) => call<WorldView & { ownerFence: number; leaderPlayerId: string }>(who.token, path);
  const parties = (who = actors[0]) => call<PartyState>(who.token, '/parties');
  const partyAction = async (who: typeof actors[number], action: unknown) => {
    const current = await parties(who);
    return call<{ invitationId?: string }>(who.token, '/parties/actions', { operationId: randomUUID(), expectedPartyId: current.party?.id ?? null,
      expectedRevision: current.party?.revision ?? 0, action });
  };
  const inventory = (who: typeof actors[number]) => call<InventoryView>(who.token, `/characters/${who.hero.id}/inventories`);
  const grant = async (who: typeof actors[number], itemId: string) => (await main!.get(InventoryService).receive(who.hero.id, itemId, 1, randomUUID())).itemIds[0];
  const makeMine = async (who: typeof actors[number], instanceId: string) => {
    const current = await state(who), p = current.location!.position!;
    return { operationId: randomUUID(), expectedRevision: current.revision,
      action: { type: 'harvest', position: { ...p, y: p.y - 1 }, toolInstanceId: instanceId } };
  };
  const sealed = (who: typeof actors[number], characterId = who.hero.id) => call<{ id: string; cargo: unknown }[]>(who.token, `${path}/manifests?characterId=${characterId}`);
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    Object.assign(process.env, { POSTGRES_URL: isolated.toString(), WORLD_POSTGRES_URL: isolated.toString(), MONGO_URL: mongoUrl, MONGO_DB: mongoName,
      REDIS_URL: redisUrl, REDIS_NAMESPACE: namespace, WORLD_SERVICE_TOKEN: randomBytes(32).toString('hex'), WORLD_URL: '',
      RABBITMQ_URL: rabbitUrl, RABBITMQ_NAMESPACE: rabbitNamespace });
    main = await mainApp();
    world = await NestFactory.create(WorldAppModule, { logger: false }); world.setGlobalPrefix('api/v1'); world.useGlobalFilters(new WorldValidationFilter());
    await world.listen(0, '127.0.0.1'); worldUrl = `http://127.0.0.1:${world.getHttpServer().address().port}`; process.env.WORLD_URL = worldUrl;
    for (const name of ['Лидер', 'Спутник']) {
      const account = await call<Account>('', '/accounts', { name: `${name} ${suffix.slice(0, 8)}` });
      const login = await call<AccountLogin>('', '/identity/session', { accountId: account.id });
      const hero = await call<Character>(login.token, '/characters', { name });
      await call(login.token, '/identity/session/character', { characterId: hero.id });
      actors.push({ account, hero, token: login.token });
    }
    const [a, b] = actors;
    const aShovel = await grant(a, 'digging-shovel'), bShovel = await grant(b, 'digging-shovel');
    const axes = [await grant(a, 'woodcutting-axe'), await grant(a, 'copper-axe')];
    await t.test('session-derived solo party, leader admission and joining the same expedition', async () => {
      await call('', '/world/expeditions', { worldId, operationId: randomUUID() }, 401);
      assert.deepEqual(await call(a.token, '/world/expeditions/current'), { worldId: null, state: null });
      assert.equal((await parties(a)).party, null);
      await call(a.token, '/world/expeditions', { worldId, operationId: randomUUID(), actor: {} }, 400);
      const start = { worldId, operationId: randomUUID() };
      const started = await call<WorldCommandResult>(a.token, '/world/expeditions', start);
      assert.deepEqual(await call(a.token, '/world/expeditions', start), started);
      assert.equal((await parties(a)).party!.members.length, 1);
      assert.deepEqual(await call(a.token, '/world/expeditions/current'), { worldId, state: 'active' });
      await call(a.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: 0, action: { type: 'enter' } });
      await call(b.token, path, undefined, 403);
      const invitation = await partyAction(a, { type: 'invite', targetPlayerId: b.account.id });
      await partyAction(b, { type: 'accept', invitationId: invitation.invitationId });
      assert.deepEqual(await call(b.token, '/world/expeditions/current'), { worldId, state: 'active' });
      assert.deepEqual((await state(a)).location, (await state(b)).location);
      await call(b.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: (await state(b)).revision, action: { type: 'leave' } }, 403);
    });

    await t.test('ownership and tool class are resolved on the main server; supplied authority is rejected', async () => {
      const request = await makeMine(b, bShovel);
      await call(b.token, `${path}/actions`, { ...request, tool: { toolClassId: 'shovel' } }, 400);
      await call(b.token, `${path}/actions`, { ...request, action: { ...request.action, toolClassId: 'shovel' } }, 400);
      await call(b.token, `${path}/actions`, { ...request, action: { ...request.action, toolInstanceId: aShovel } }, 400);
      const wrongClass = await makeMine(a, axes[0]);
      await call(a.token, `${path}/actions`, wrongClass, 400);
      assert.equal((await state(a)).xp, 0);
      assert.equal((await main!.get(Database).sql.selectFrom('inventory_world_reservations').selectAll().execute()).length, 0);
      await call(b.token, `${path}/actions`, request);
      assert.equal((await state(b)).xp, 1); assert.deepEqual((await state(a)).cargo, []);
    });

    await t.test('lost world reply keeps a durable reservation across main-server restart and recovers without extra mining', async () => {
      const remote = main!.get(WorldRemote), deliver = remote.deliver.bind(remote);
      const mining = await makeMine(b, bShovel); let lost = false;
      remote.deliver = async envelope => {
        if (lost) throw new Error('simulated offline');
        const result = await deliver(envelope);
        if (envelope.payload.kind === 'action' && envelope.payload.request.command.operationId === mining.operationId) { lost = true; throw new Error('simulated lost response'); }
        return result;
      };
      await call(b.token, `${path}/actions`, mining, 503);
      const pending = await call<{ state: string }>(b.token, `${path}/operations/${mining.operationId}`); assert.equal(pending.state, 'pending');
      await call(b.token, `/item-instances/${bShovel}`, { operationId: randomUUID(), quantity: 1 }, 409, 'DELETE');
      const bag = await call<{ inventoryId: string }>(b.token, `/characters/${b.hero.id}/inventories`, { operationId: randomUUID(), name: 'Запасной рюкзак', capacity: 5 });
      await call(b.token, '/inventory-transfers', { operationId: randomUUID(), instanceId: bShovel, targetInventoryId: bag.inventoryId, quantity: 1 }, 409);
      process.env.RABBITMQ_URL = 'amqp://game:game@127.0.0.1:1'; await main!.close(); main = undefined; main = await mainApp();
      assert.equal((await main!.get(Database).sql.selectFrom('inventory_world_reservations').selectAll().where('instance_id', '=', bShovel).execute()).length, 1);
      process.env.RABBITMQ_URL = rabbitUrl;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await main!.get(WorldGatewayService).drain(worldId);
        if ((await call<{ state: string }>(b.token, `${path}/operations/${mining.operationId}`)).state === 'complete') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const recovered = await call<WorldCommandResult>(b.token, `${path}/actions`, mining);
      assert.equal(recovered.outcome.xpGained, 1); assert.equal((await state(b)).xp, 2);
      assert.deepEqual(await call(b.token, `${path}/actions`, mining), recovered);
      assert.equal((await main!.get(Database).sql.selectFrom('inventory_world_reservations').selectAll().execute()).length, 0);
      const otherBag = (await inventory(b)).inventories.find(entry => !entry.primary)!;
      await call(b.token, '/inventory-transfers', { operationId: randomUUID(), instanceId: bShovel, targetInventoryId: otherBag.id, quantity: 1 });
      const primary = (await inventory(b)).inventories.find(entry => entry.primary)!;
      await call(b.token, '/inventory-transfers', { operationId: randomUUID(), instanceId: bShovel, targetInventoryId: primary.id, quantity: 1 });
    });

    // Put a known resource beside the party through the world owner's test fixture, never via the main server's SQL.
    const resource = async (blockId: string) => world!.get(WorldTransactions).run(async context => {
      const repository = world!.get(WorldRepository), record = (await repository.load(worldId, context))!;
      const position = { ...record.state.location!.position!, x: record.state.location!.position!.x + 1 };
      const region = record.state.regions.find(entry => entry.cellId === record.state.location!.cellId)!;
      writeWorldBlock(region, position, blockId); region.revision++;
      const revision = record.state.revision++; await repository.save(record.state, revision, context); return position;
    });
    await t.test('two canonical axes work by class; leadership changes preserve the altered world', async () => {
      for (const [index, blockId] of ['oak-trunk', 'pine-trunk'].entries()) {
        const position = await resource(blockId), before = await state(a);
        await call(a.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: before.revision, action: { type: 'harvest', position, toolInstanceId: axes[index] } });
      }
      const before = await state(a);
      await partyAction(a, { type: 'transfer', targetPlayerId: b.account.id });
      const after = await state(b);
      assert.equal(after.id, before.id); assert.deepEqual(after.location, before.location); assert.deepEqual(after.region, before.region);
      assert.equal(after.leaderPlayerId, b.account.id); assert.ok(after.ownerFence > before.ownerFence);
      await call(a.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: after.revision, action: { type: 'leave' } }, 403);
      await call(b.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: after.revision, action: { type: 'leave' } });
      await call(b.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: after.revision + 1, action: { type: 'enter' } });
    });

    await t.test('exclusion revokes fresh access but preserves owner cargo; rejoining does not generate a fresh region', async () => {
      const before = await state(a), oldMembership = (await parties(a)).party!.members.find(member => member.playerId === a.account.id)!.membershipId;
      await partyAction(b, { type: 'kick', targetPlayerId: a.account.id });
      await call(a.token, path, undefined, 403);
      assert.deepEqual(await call(a.token, '/world/expeditions/current'), { worldId: null, state: null });
      const manifests = await sealed(a); assert.deepEqual(manifests[0].cargo, before.cargo);
      await call(a.token, `${path}/manifests?characterId=${b.hero.id}`, undefined, 403);
      const invitation = await partyAction(b, { type: 'invite', targetPlayerId: a.account.id });
      await partyAction(a, { type: 'accept', invitationId: invitation.invitationId });
      const rejoined = await state(a); assert.equal(rejoined.xp, before.xp); assert.deepEqual(rejoined.cargo, []); assert.deepEqual(rejoined.region, before.region);
      assert.notEqual((await parties(a)).party!.members.find(member => member.playerId === a.account.id)!.membershipId, oldMembership);
    });

    await t.test('an admitted action settles before the queued exclusion, while fresh excluded commands fail immediately', async () => {
      const position = await resource('oak-trunk'), before = await state(a);
      const mining = { operationId: randomUUID(), expectedRevision: before.revision, action: { type: 'harvest', position, toolInstanceId: axes[0] } };
      const remote = main!.get(WorldRemote), deliver = remote.deliver.bind(remote);
      remote.deliver = async () => { throw new Error('simulated offline before delivery'); };
      await call(a.token, `${path}/actions`, mining, 503);
      await partyAction(b, { type: 'kick', targetPlayerId: a.account.id });
      await call(a.token, `${path}/actions`, { ...mining, operationId: randomUUID() }, 403);
      await call(a.token, path, undefined, 403);
      remote.deliver = deliver;
      await call(a.token, `${path}/actions`, mining);
      const manifests = await sealed(a); assert.equal(manifests.length, 2); assert.equal(new Set(manifests.map(entry => entry.id)).size, 2);
      assert.equal((await main!.get(Database).sql.selectFrom('inventory_world_reservations').selectAll().execute()).length, 0);
    });

    await t.test('character changes keep loot attached to the old hero, and disband closes the same world', async () => {
      const original = await state(b);
      const another = await call<Character>(b.token, '/characters', { name: 'Другой герой' });
      await call(b.token, '/identity/session/character', { characterId: another.id });
      await call(b.token, path, undefined, 409);
      await call(b.token, '/world/expeditions/current', undefined, 409);
      await partyAction(b, { type: 'change-character' });
      const switched = await state(b); assert.equal(switched.xp, 0); assert.deepEqual(switched.cargo, []);
      assert.deepEqual((await sealed(b, b.hero.id))[0].cargo, original.cargo);
      await partyAction(b, { type: 'disband' });
      await main!.get(WorldGatewayService).drain(worldId);
      const record = await world!.get(WorldTransactions).run(context => world!.get(WorldRepository).load(worldId, context));
      assert.equal(record!.state.status, 'closed'); assert.deepEqual(record!.state.regions, []);
      assert.deepEqual((await sealed(b, b.hero.id))[0].cargo, original.cargo);
      await call(b.token, `${path}/actions`, { operationId: randomUUID(), expectedRevision: record!.state.revision, action: { type: 'enter' } }, 403);
    });
  } finally {
    if (main) await main.close(); if (world) await world.close();
    await removeTestQueues(rabbitUrl, rabbitNamespace);
    const mongo = new MongoClient(mongoUrl); try { await mongo.connect(); await mongo.db(mongoName).dropDatabase(); } finally { await mongo.close(); }
    const redis = new Redis(redisUrl); try { const keys = await redis.keys(`${namespace}:*`); if (keys.length) await redis.del(...keys); } finally { redis.disconnect(); }
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); await admin.end();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
