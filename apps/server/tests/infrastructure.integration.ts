import { verifySocial } from './helpers/social-infrastructure';
import { verifyGathering } from './helpers/gathering-infrastructure';
import { verifyParties } from './helpers/parties-infrastructure';
import { verifyPartyChat } from './helpers/party-chat-infrastructure';
import { verifyChat } from './helpers/chat-infrastructure';
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
import { Account, AccountLogin, Battle, Character, Content, InventoryView, InventoryResult, findBattlefieldMove, findBattlefieldMatches, gainExperience, combatStatDefinitions, defaultModifierDefinitions, defaultCombatFormulaRules, seedContent, seedEffectSkills, skillChoices } from '@game/core';
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
import { BattlesService } from '../src/modules/battles/application/battles.service';
import { BattleRuntime } from '../src/modules/battles/ports/battle-runtime';
import { BattleTimeoutService } from '../src/modules/battles/application/battle-timeout.service';
import { ContentService } from '../src/modules/content/application/content.service';

async function eventually(check: () => Promise<boolean>, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail('Expected background work did not finish in time');
}

test('real infrastructure: REST commands, WS push, cache, transactional rewards, retry and archive', { timeout: 60000 }, async () => {
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
    // Custom v1 content must survive initialization; missing records are seeded independently.
    await mongo.db(databaseName).collection('settings').insertOne({ id: 'balance', ...structuredClone(seedContent.balance), attributes: { skillReferencePower: 8 }, formulas: defaultCombatFormulaRules, teamSize: 2 });
    const inferno = structuredClone(seedContent.skills.find(skill => skill.id === 'inferno')!); inferno.power = 47;
    await mongo.db(databaseName).collection('skills').insertOne(inferno);
    await mongo.db(databaseName).collection('statDefinitions').insertOne({ ...combatStatDefinitions.find(stat => stat.id === 'strength')!, name: 'Своя сила' });
    await mongo.db(databaseName).collection('modifierDefinitions').insertOne({ ...defaultModifierDefinitions[0], id: 'custom-strength', name: 'Свой доп', statId: 'strength', allowArmor: false, baseValue: 10000, itemRoll: { minFactorBps: 2, maxFactorBps: 7, scalingProfileId: 'flat-stat' } });
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.get(BattleRuntime).random = () => 0; // Existing scenarios choose team 0; lottery has its own test.
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ValidationFilter());
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    assert.equal((await fetch(`${origin}/api/content`)).status, 404);
    let authToken = '';
    const request = async <T>(path: string, body?: object, status = body ? 201 : 200, method = body ? 'POST' : 'GET'): Promise<T> => {
      const response = await fetch(`${origin}/api/v1${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      // Server clock is intentionally volatile; compare canonical snapshots below.
      if (result && !Array.isArray(result) && 'serverTime' in result) delete result.serverTime;
      assert.equal(response.status, status, JSON.stringify(result));
      return result as T;
    };

    const accounts = await request<Account[]>('/accounts');
    const login = await request<AccountLogin>('/identity/session', { accountId: accounts[0].id });
    authToken = login.token;
    assert.equal(login.characterId, null);
    assert.equal((await request<Character[]>('/characters')).length, 5);
    await verifyIdentity(origin, request, accounts, authToken, app);
    const partyCheckpoint = await verifyParties(app, origin);
    const chatCheckpoint = await verifyChat(app, origin, authToken, accounts);
    const blockedCheckpoint = await verifySocial(app, origin, authToken, accounts);
    const partyChatCheckpoint = await verifyPartyChat(app, origin);
    const catalog = await request<Content>('/content');
    assert.equal(catalog.balance.formulas?.version, 1);
    assert.equal(catalog.statDefinitions!.find(stat => stat.id === 'strength')!.name, 'Своя сила');
    const hpDefinition = catalog.statDefinitions!.find(stat => stat.id === 'maxHp')!;
    assert.equal(hpDefinition.kind === 'derived' && hpDefinition.formula.constant, 60);
    assert.equal(catalog.skills.length, seedContent.skills.length + seedEffectSkills.length); assert.equal(catalog.balance.progression.startingSkillPoints, 2);
    assert.equal(catalog.balance.progression.statGrowth.maxEnergy, 0); assert.equal(catalog.balance.teamSize, 2);
    assert.equal(catalog.skills.find(skill => skill.id === 'strike')!.cost, 3);
    assert.equal(catalog.skills.find(skill => skill.id === 'inferno')!.learning.stats.maxEnergy, 30);
    assert.equal(catalog.skills.find(skill => skill.id === 'inferno')!.power, 47);
    assert.equal((await request<object[]>('/skills')).length, seedContent.skills.length + seedEffectSkills.length);
    assert.equal((await request<object[]>('/items')).length, seedContent.items.length);
    await request('/battles/not-a-uuid', undefined, 400);
    const character = await request<Character>('/characters', { name: 'Интеграционный герой' });
    assert.equal(character.skillPoints, 2); assert.deepEqual(character.learnedSkillIds, ['strike']);
    await verifyCharacterCreation(character, request, app);
    await verifyCharacterAttributes(request, app, catalog);
    await verifyRankedCrafting(request, app);
    const gatheringCheckpoint = await verifyGathering(app, origin, authToken, request);
    await verifyBattleEffects(request, app);
    await verifyModifierModel(request, app);
    await verifyCombatFormulas(request, app);
    await verifyEquipmentLock(request, app);
    await verifyStunAndPotionSnapshots(request, app);
    await verifyBattleSession(request, app);
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
      await request('/battles', { name: 'Неверное поле', characterId: character.id, kind: 'bot', rule: 'on-match', battlefield }, 400);
    }
    const defaults = await request<Battle>('/battles', { name: 'Поле по умолчанию', characterId: character.id, kind: 'bot', rule: 'on-match' });
    assert.deepEqual(defaults.battlefield?.size, { rows: 8, cols: 8 });
    assert.equal(defaults.battlefield?.elementTypes.length, 6);
    const room = await request<Battle>('/battles', { name: 'Интеграционный бой', characterId: character.id, kind: 'bot', rule: 'on-match', battlefield: { size: { rows: 6, cols: 10 }, elementTypes: ['physical', 'water', 'defense'] } });
    assert.deepEqual(room.battlefield?.size, { rows: 6, cols: 10 });
    assert.ok(room.board.flat().every(type => ['physical', 'water', 'defense'].includes(type)));
    const started = await request<Battle>(`/battles/${room.id}/start`, { characterId: character.id, version: room.version });
    assert.equal(started.fighters[0].skillLevels?.strike, 10);
    assert.equal(started.fighters[1].skillLevels?.strike, 10);
    const equipped = (await request<InventoryView>(`/characters/${character.id}/inventories`)).items.find(item => item.equippedSlot)!;
    const frozenAttack = started.fighters[0].stats.attack;
    assert.equal(equipped.actions.find(action => action.id === 'unequip')!.enabled, false);
    await request(`/item-instances/${equipped.id}/actions`, { action: 'unequip', operationId: randomUUID() }, 409);
    assert.equal((await request<Battle>(`/battles/${room.id}`)).fighters[0].stats.attack, frozenAttack);
    const database = app.get(Database);
    // Both the player and NPC can spend a turn rearranging a stable board without matches.
    const originalBattlefield = structuredClone(started.battlefield);
    started.battlefield = { size: { rows: 1, cols: 4 }, elementTypes: ['physical', 'water', 'defense'] };
    started.board = [['physical', 'water', 'defense', 'physical']];
    await database.sql.updateTable('battles').set({ data: JSON.stringify(started) }).where('id', '=', room.id).execute();
    const rearranged = await request<Battle>(`/battles/${room.id}/actions`, { characterId: character.id, version: started.version,
      action: { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: started.fighters[1].id } });
    assert.equal(rearranged.turn, started.turn + 2); assert.equal(rearranged.activeId, started.activeId);
    assert.equal(rearranged.version, started.version + 1); assert.equal(rearranged.phase, 'before');
    assert.equal(rearranged.boardMoves?.length, 2);
    for (const report of rearranged.boardMoves!) { assert.equal(report.total.count, 0); assert.deepEqual(report.steps, []); }
    assert.deepEqual(rearranged.fighters.map(fighter => fighter.skillEnergy), started.fighters.map(fighter => fighter.skillEnergy));
    assert.deepEqual(rearranged.fighters.map(fighter => fighter.hp), started.fighters.map(fighter => fighter.hp));
    assert.deepEqual((await request<Battle>(`/battles/${room.id}`)).board, rearranged.board);
    assert.deepEqual((await request<Battle>(`/battles/${room.id}`)).boardMoves, rearranged.boardMoves);
    Object.assign(started, rearranged);
    started.battlefield = originalBattlefield;
    // Test fixture: one legal move will finish the battle, without relying on random cascades.
    const strong = started.fighters.find(fighter => !fighter.npc)!;
    started.attributeRngState = 0;
    strong.stats.attack = 10000;
    if (strong.attributes) strong.attributes.effective.physicalPower = 10000;
    started.board = Array.from({ length: 6 }, (_, row) => Array.from({ length: 10 }, (_, col) => (row + col) % 2 ? 'water' : 'physical'));
    await database.sql.updateTable('battles').set({ data: JSON.stringify(started) }).where('id', '=', room.id).execute();

    socket = io(origin, { autoConnect: false, reconnection: false, auth: { token: authToken } });
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
    assert.equal(move.generated.count, 0);
    assert.equal(moved.matchPowerBps, 19000);
    assert.equal(moved.pendingBattlefield, undefined);
    const pendingMove = (await database.sql.selectFrom('battles').select('data').where('id', '=', room.id).executeTakeFirstOrThrow()).data.pendingBattlefield;
    assert.ok(pendingMove);
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
    assert.equal(result.fighters[0].skillEnergy, Math.min(30, moved.fighters[0].skillEnergy! - 3 + pendingMove.report.generated.count));
    assert.equal(result.pendingBattlefield, undefined);
    assert.equal((await request<Character>(`/characters/${character.id}`)).level, 2);
    assert.equal((await request<Character>(`/characters/${character.id}`)).attributePoints, 10);
    assert.equal((await database.sql.selectFrom('battle_rewards').selectAll().where('battle_id', '=', room.id).execute()).length, 1);
    await eventually(async () => snapshots.some(value => value.id === room.id && value.version === result.version));

    const archives = mongo.db(databaseName).collection('battleArchives');
    await eventually(async () => await archives.countDocuments({ id: room.id }) === 1);
    const archived = await archives.findOne({ id: room.id }, { projection: { _id: 0 } });
    const persistedResult = (await database.sql.selectFrom('battles').select('data').where('id', '=', room.id).executeTakeFirstOrThrow()).data;
    assert.equal(result.attributeRngState, undefined);
    assert.equal(typeof persistedResult.attributeRngState, 'number');
    assert.deepEqual(archived, persistedResult);
    const outbox = await database.sql.selectFrom('battle_archive_outbox').selectAll().where('id', '=', room.id).executeTakeFirstOrThrow();
    await eventually(async () => (await database.sql.selectFrom('battle_archive_outbox').select('delivered_at').where('id', '=', room.id).executeTakeFirst())?.delivered_at != null);
    assert.deepEqual(outbox.data, persistedResult);
    // MongoDB idempotency also protects a replay after BullMQ's completed job retention expires.
    await app.get(BattleHistoryRepository).archive(result);
    assert.equal(await archives.countDocuments({ id: room.id }), 1);

    const twoTypes = await request<Battle>('/battles', { name: 'Две стихии', characterId: character.id, kind: 'bot', rule: 'on-match', battlefield: { size: 8, elementTypes: ['physical', 'water'] } });
    const twoStarted = await request<Battle>(`/battles/${twoTypes.id}/start`, { characterId: character.id, version: twoTypes.version });
    twoStarted.board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row + col) % 2 ? 'water' : 'physical'));
    await database.sql.updateTable('battles').set({ data: JSON.stringify(twoStarted) }).where('id', '=', twoStarted.id).execute();
    const twoMove = { from: { row: 1, col: 6 }, to: { row: 1, col: 7 } };
    const paused = await request<Battle>(`/battles/${twoTypes.id}/actions`, { characterId: character.id, version: twoStarted.version, action: { type: 'swap', ...twoMove, targetId: 'bot-opponent' } });
    assert.equal(paused.phase, 'choose');
    assert.deepEqual(paused.board, paused.boardMoves![0].steps[0].boardAfter);
    const settled = await request<Battle>(`/battles/${twoTypes.id}/actions`, { characterId: character.id, version: paused.version, action: { type: 'end' } });
    assert.equal(settled.pendingBattlefield, undefined);
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
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ValidationFilter());
    await app.listen(0, '127.0.0.1');
    const recovered = await fetch(`${await app.getUrl()}/api/v1/chat/feed?view=world`, { headers: { Authorization: `Bearer ${authToken}` } });
    assert.equal(recovered.status, 200);
    assert.ok((await recovered.json()).messages.some((message: { id: string }) => message.id === chatCheckpoint));
    const restoredSocial = await fetch(`${await app.getUrl()}/api/v1/social`, { headers: { Authorization: `Bearer ${authToken}` } });
    assert.equal(restoredSocial.status, 200);
    assert.ok((await restoredSocial.json()).relationships.some((row: { playerId: string; blocked: boolean }) => row.playerId === blockedCheckpoint && row.blocked));
    const gatheringPath = `${await app.getUrl()}/api/v1/characters/${gatheringCheckpoint.heroId}/gathering`;
    const restoredGathering = await fetch(gatheringPath, { headers: { Authorization: `Bearer ${authToken}` } });
    assert.equal(restoredGathering.status, 200);
    assert.deepEqual(await restoredGathering.json(), gatheringCheckpoint.receipt.view);
    const replayedGathering = await fetch(`${gatheringPath}/actions`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(gatheringCheckpoint.command) });
    assert.equal(replayedGathering.status, 201);
    assert.deepEqual(await replayedGathering.json(), gatheringCheckpoint.receipt);
    const restoredParty = await fetch(`${await app.getUrl()}/api/v1/parties`, { headers: { Authorization: `Bearer ${partyCheckpoint.token}` } });
    assert.equal(restoredParty.status, 200);
    assert.deepEqual((await restoredParty.json()).party, partyCheckpoint.party);
    const restoredInvitation = await fetch(`${await app.getUrl()}/api/v1/parties`, { headers: { Authorization: `Bearer ${partyCheckpoint.recipientToken}` } });
    assert.equal(restoredInvitation.status, 200);
    assert.ok((await restoredInvitation.json()).incoming.some((invitation: { id: string }) => invitation.id === partyCheckpoint.invitationId));
    const replayedParty = await fetch(`${await app.getUrl()}/api/v1/parties/actions`, { method: 'POST', headers: { Authorization: `Bearer ${partyCheckpoint.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(partyCheckpoint.command) });
    assert.equal(replayedParty.status, 200); assert.equal((await replayedParty.json()).invitationId, partyCheckpoint.invitationId);
    const restoredPartyChat = await fetch(`${await app.getUrl()}/api/v1/chat/feed?view=party`, { headers: { Authorization: `Bearer ${partyChatCheckpoint.token}` } });
    assert.equal(restoredPartyChat.status, 200);
    assert.ok((await restoredPartyChat.json()).messages.some((message: { id: string }) => message.id === partyChatCheckpoint.messageId));
    const outsiderPartyChat = await fetch(`${await app.getUrl()}/api/v1/chat/feed?view=all`, { headers: { Authorization: `Bearer ${partyChatCheckpoint.outsiderToken}` } });
    assert.equal(outsiderPartyChat.status, 200);
    assert.ok(!(await outsiderPartyChat.json()).messages.some((message: { id: string }) => message.id === partyChatCheckpoint.messageId));
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
  const groups = await request<{ id: string }[]>('/items/groups');
  assert.equal(groups.length, 6);
  assert.ok(groups.some(group => group.id === 'tools'));
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
  assert.equal(hero.attributePoints, 5);
  assert.equal(hero.attributes?.base.physicalPower, 8);
  const service = app.get(CharactersService);
  const grown = await app.get(UnitOfWork).run(context => service.update(hero.id, content, character => {
    gainExperience(character, 100, content.balance.progression);
  }, context));
  assert.equal(grown.attributePoints, 10);
  assert.equal(grown.attributes?.base.physicalPower, 9);
  const allocate = (allocations: Record<string, number>, expectedRevision: number, status = 201) => request<Character>(`/characters/${hero.id}/attributes`, { allocations, expectedRevision }, status);
  const race = await Promise.allSettled([allocate({ strength: 3 }, grown.attributeRevision!), allocate({ intelligence: 3 }, grown.attributeRevision!)]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = race.find(result => result.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' ? rejected.reason.actual : undefined, 409);
  const current = await request<Character>(`/characters/${hero.id}`);
  assert.equal(current.attributePoints, 7);
  await allocate({ strength: 8 }, current.attributeRevision!, 400);
  await allocate({ strength: -1 }, current.attributeRevision!, 400);
  await allocate({ physicalPower: 1 }, current.attributeRevision!, 400);
  assert.equal((await request<Character>(`/characters/${hero.id}`)).attributePoints, 7);

  const item = { ...seedContent.items.find(item => item.id === 'iron-sword')!, id: 'attribute-test-sword', attributeRequirements: { vitality: 12 } };
  await app.get(MongoDatabase).db.collection('items').insertOne(item);
  const inventory = app.get(InventoryService);
  const received = await inventory.receive(hero.id, item.id, 1, randomUUID());
  const instanceId = received.itemIds[0];
  const blocked = (await inventory.get(hero.id)).items.find(item => item.id === instanceId)!.actions.find(action => action.id === 'equip')!;
  assert.equal(blocked.enabled, false); assert.match(blocked.reason!, /Выносливость 12/);
  await request(`/item-instances/${instanceId}/actions`, { action: 'equip', operationId: randomUUID() }, 400);
  const increased = await allocate({ vitality: 2 }, current.attributeRevision!);
  assert.equal(increased.attributePoints, 5);
  assert.equal(increased.attributes?.base.maxHp, 138);
  await request(`/item-instances/${instanceId}/actions`, { action: 'equip', operationId: randomUUID() });
  const equipped = await request<Character>(`/characters/${hero.id}`);
  assert.ok(equipped.attributes!.equipped.physicalPower > equipped.attributes!.base.physicalPower);
  assert.deepEqual(equipped.baseAttributes, increased.baseAttributes);
  const persisted = await app.get(Database).sql.selectFrom('characters').select('data').where('id', '=', hero.id).executeTakeFirstOrThrow();
  assert.equal(persisted.data.attributePoints, 5);
  assert.equal(persisted.data.baseAttributes?.vitality, 12);
}

async function verifyBattleEffects(request: TestRequest, app: INestApplication) {
  const first = await request<Character>('/characters', { name: 'Маг усилений' });
  const second = await request<Character>('/characters', { name: 'Маг ослаблений' });
  await app.get(UnitOfWork).run(context => app.get(CharactersService).update(first.id, seedContent, character => { character.skillPoints = 3; }, context));
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
  assert.equal(item.itemLevel, 1); assert.equal(item.quality!.version, 1);
  const savedItem = await app.get(Database).sql.selectFrom('item_instances').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
  assert.equal(savedItem.item_level, 1); assert.equal(savedItem.definition_version, 1);
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

async function verifyModifierModel(request: TestRequest, app: INestApplication) {
  const mongo = app.get(MongoDatabase).db, content = app.get(ContentService), db = app.get(Database);
  const current = await content.get(true);
  const migrated = current.modifierDefinitions!.find(value => value.id === 'custom-strength')!;
  assert.equal(migrated.formatVersion, 1); assert.equal(migrated.version, 1);
  assert.equal(migrated.itemRoll!.minFactorBps, 2); assert.equal(migrated.itemRoll!.maxFactorBps, 7);
  assert.equal(migrated.allowBuff, true); assert.equal(migrated.allowPotion, false);
  const skill = structuredClone(seedEffectSkills[0]);
  skill.id = 'probability-check'; skill.targeting = { kind: 'self' };
  skill.effects = [{ ...skill.effects![0], id: 'never', activationChanceBps: 1 },
    { id: 'guaranteed', recipient: 'caster', kind: 'stat_modifier', modifierDefinitionId: 'physical-power', modifierDefinitionVersion: current.modifierDefinitions!.find(value => value.id === 'physical-power')!.version,
      coefficientBps: 5000, statId: 'physicalPower', operation: 'add_flat', magnitude: { unit: 'points', constant: 0 }, polarity: 'buff', durationTurns: 2, stackKey: 'probability-guaranteed', activationChanceBps: 10000 }];
  await mongo.collection('skills').insertOne(skill); await content.get(true);
  const first = await request<Character>('/characters', { name: 'Проверка шансов' });
  const second = await request<Character>('/characters', { name: 'Вторая цель' });
  await request(`/characters/${first.id}/skills`, { skillId: skill.id });
  const room = await request<Battle>('/battles', { name: 'Проверка допов', characterId: first.id, kind: 'duel' });
  await request(`/battles/${room.id}/join`, { characterId: second.id, team: 1 });
  let battle = await request<Battle>(`/battles/${room.id}/start`, { characterId: first.id, version: 1 });
  await app.get(UnitOfWork).run(async tx => {
    const row = await app.get(BattlesRepository).lock(battle.id, tx); assert.ok(row);
    row.battle.phase = 'choose'; row.battle.matchedElements = [skill.element]; row.battle.attributeRngState = 0;
    row.battle.fighters.find(fighter => fighter.id === first.id)!.skillEnergy = 30;
    await app.get(BattlesRepository).save(row.battle, tx);
  });
  const version = battle.version;
  battle = await request<Battle>(`/battles/${battle.id}/actions`, { characterId: first.id, version, action: { type: 'skill', skillId: skill.id, targetId: first.id } });
  assert.equal(battle.attributeRngState, undefined);
  assert.deepEqual(battle.effectResults!.map(value => value.outcome), ['chance_failed', 'applied']);
  const stored = (await db.sql.selectFrom('battles').select('data').where('id', '=', battle.id).executeTakeFirstOrThrow()).data;
  assert.equal(stored.attributeRngState, 1013904223);
  assert.equal(stored.fighters.find(fighter => fighter.id === first.id)!.activeEffects![0].magnitude, 5);
  await request(`/battles/${battle.id}/actions`, { characterId: first.id, version, action: { type: 'skill', skillId: skill.id, targetId: first.id } }, 409);
  assert.deepEqual((await db.sql.selectFrom('battles').select('data').where('id', '=', battle.id).executeTakeFirstOrThrow()).data, stored);

  // Item level and all generated snapshots are persisted independently from subsequent catalog edits.
  await mongo.collection('items').updateOne({ id: 'iron-sword' }, { $set: { itemLevel: 11 } });
  try {
    const crafted = await request<InventoryResult>(`/characters/${first.id}/crafting/recipes/craft-rare-sword/apply`, { operationId: randomUUID() });
    assert.equal(crafted.createdItems![0].itemLevel, 11);
    assert.ok(crafted.createdItems![0].quality!.affixes.every(value => value.minValue! >= 2));
    const item = await request<{ itemLevel: number }>(`/item-instances/${crafted.createdItems![0].id}`);
    assert.equal(item.itemLevel, 11);
  } finally { await mongo.collection('items').updateOne({ id: 'iron-sword' }, { $set: { itemLevel: 1 } }); await content.get(true); }
}


async function verifyCombatFormulas(request: TestRequest, app: INestApplication) {
  const first = await request<Character>('/characters', { name: 'Проверка точности' });
  const second = await request<Character>('/characters', { name: 'Удачливый соперник' });
  await request(`/characters/${first.id}/skills`, { skillId: 'ember' });
  const room = await request<Battle>('/battles', { name: 'Формулы и удача', characterId: first.id, kind: 'duel' });
  await request(`/battles/${room.id}/join`, { characterId: second.id, team: 1 });
  let battle = await request<Battle>(`/battles/${room.id}/start`, { characterId: first.id, version: 1 });
  assert.equal(battle.content.balance.formulas!.armorK, 30);
  assert.ok(battle.fighters.every(fighter => fighter.combatLevel === 1));
  const repository = app.get(BattlesRepository), uow = app.get(UnitOfWork);
  const prepare = async (skillId: string, seed: number, legacy = false) => {
    await uow.run(async tx => {
      const row = (await repository.lock(battle.id, tx))!;
      row.battle.activeId = first.id; row.battle.phase = 'choose'; row.battle.usedSkill = false;
      row.battle.attributeRngState = seed; row.battle.matchedElements = [skillId === 'ember' ? 'fire' : 'physical'];
      const actor = row.battle.fighters.find(fighter => fighter.id === first.id)!;
      const target = row.battle.fighters.find(fighter => fighter.id === second.id)!;
      actor.skillEnergy = 30; actor.cooldowns[skillId] = 0; actor.attributes!.effective.criticalChanceBps = 0;
      target.attributes!.effective.luck = 110; target.hp = 120;
      if (legacy) delete row.battle.content.balance.formulas;
      row.battle.skillChoices = skillChoices(row.battle, actor);
      await repository.save(row.battle, tx);
    });
    battle = await request<Battle>(`/battles/${battle.id}`);
  };
  const cast = (skillId: string, version = battle.version, status = 201) => request<Battle>(`/battles/${battle.id}/actions`, {
    characterId: first.id, version, action: { type: 'skill', skillId, targetId: second.id },
  }, status);
  await prepare('ember', 2000);
  const preview = battle.skillChoices!.find(choice => choice.skillId === 'ember')!.damagePreviews![0];
  assert.equal(preview.hitChanceBps, 10000); assert.equal(preview.luckAvoidChanceBps, 500);
  const database = app.get(Database);
  const saved = () => database.sql.selectFrom('battles').select('data').where('id', '=', battle.id).executeTakeFirstOrThrow();
  const before = (await saved()).data, save = repository.save;
  repository.save = async () => { throw new Error('simulated formula save failure'); };
  try { await cast('ember', battle.version, 500); } finally { repository.save = save; }
  assert.deepEqual((await saved()).data, before);
  const version = battle.version;
  battle = await cast('ember');
  assert.equal(battle.damageResults![0].outcome, 'luck_avoided');
  assert.equal(battle.damageResults![0].hitChanceBps, 10000);
  assert.equal(battle.fighters.find(fighter => fighter.id === second.id)!.hp, 120);
  assert.equal(battle.fighters.find(fighter => fighter.id === first.id)!.skillEnergy, 30 - seedContent.skills.find(skill => skill.id === 'ember')!.cost);
  assert.equal(battle.attributeRngState, undefined);
  assert.equal((await saved()).data.attributeRngState, 47986927);
  await cast('ember', version, 409);
  assert.deepEqual((await request<Battle>(`/battles/${battle.id}`)).damageResults, battle.damageResults);
  await prepare('strike', 1950);
  battle = await cast('strike');
  assert.equal(battle.damageResults![0].outcome, 'miss');
  assert.equal(battle.fighters.find(fighter => fighter.id === second.id)!.hp, 120);
  await prepare('strike', 1950, true);
  battle = await cast('strike');
  assert.equal(battle.damageResults!.length, 0);
  assert.equal(battle.fighters.find(fighter => fighter.id === second.id)!.hp, 110);
}

async function verifyEquipmentLock(request: TestRequest, app: INestApplication) {
  const hero = await request<Character>('/characters', { name: 'Блокировка экипировки' });
  const inventory = app.get(InventoryService), battles = app.get(BattlesService);
  const sword = (await inventory.get(hero.id)).items.find(item => item.itemId === 'iron-sword')!;
  const room = await request<Battle>('/battles', { name: 'Гонка старта и экипировки', characterId: hero.id, kind: 'bot' });
  assert.equal((await inventory.get(hero.id)).items.find(item => item.id === sword.id)!.actions.find(action => action.id === 'equip')!.enabled, true);
  const equipOperationId = randomUUID();
  const [start, equip] = await Promise.allSettled([
    battles.start(room.id, { characterId: hero.id, version: room.version }),
    inventory.execute({ type: 'equip', instanceId: sword.id }, equipOperationId),
  ]);
  if (start.status !== 'fulfilled') throw start.reason;
  if (equip.status === 'rejected') assert.equal(equip.reason.getStatus(), 409);
  const currentHero = await request<Character>(`/characters/${hero.id}`);
  assert.equal(start.value.fighters[0].stats.attack, currentHero.attributes!.equipped.physicalPower);
  const view = await inventory.get(hero.id), currentSword = view.items.find(item => item.id === sword.id)!;
  const action = currentSword.equippedSlot ? 'unequip' : 'equip';
  assert.equal(currentSword.actions.find(value => value.id === action)!.enabled, false);
  assert.match(currentSword.actions.find(value => value.id === action)!.reason!, /активного боя/);
  const failedOperationId = randomUUID();
  await request(`/item-instances/${sword.id}/actions`, { action, operationId: failedOperationId }, 409);
  assert.deepEqual(await inventory.get(hero.id), view);
  if (equip.status === 'fulfilled') assert.deepEqual(await inventory.execute({ type: 'equip', instanceId: sword.id }, equipOperationId), equip.value);

  const another = await request<Battle>('/battles', { name: 'Второй активный бой', characterId: hero.id, kind: 'bot' });
  await request(`/battles/${another.id}/start`, { characterId: hero.id, version: another.version }, 409);
  const finish = async (battle: Battle) => {
    await app.get(UnitOfWork).run(async context => {
      const repository = app.get(BattlesRepository), row = await repository.lock(battle.id, context); assert.ok(row);
      row.battle.fighters.find(fighter => fighter.id === hero.id)!.skillEnergy = 30;
      row.battle.fighters.find(fighter => fighter.npc)!.hp = 1;
      row.battle.phase = 'choose'; row.battle.matchedElements = ['physical']; row.battle.attributeRngState = 0;
      await repository.save(row.battle, context);
    });
    const finished = await request<Battle>(`/battles/${battle.id}/actions`, { characterId: hero.id, version: battle.version, action: { type: 'skill', skillId: 'strike', targetId: 'bot-opponent' } });
    assert.equal(finished.status, 'finished');
  };
  await finish(start.value);
  const anotherStarted = await request<Battle>(`/battles/${another.id}/start`, { characterId: hero.id, version: another.version });
  assert.equal((await inventory.get(hero.id)).items.find(item => item.id === sword.id)!.actions.find(value => value.id === action)!.enabled, false);
  await finish(anotherStarted);
  assert.equal((await inventory.get(hero.id)).items.find(item => item.id === sword.id)!.actions.find(value => value.id === action)!.enabled, true);
  await request(`/item-instances/${sword.id}/actions`, { action, operationId: failedOperationId });
}


async function verifyStunAndPotionSnapshots(request: TestRequest, app: INestApplication) {
  const caster = (await request<Character[]>('/characters')).find(character => character.templateId === 'frostmage')!;
  assert.ok(caster.learnedSkillIds.includes('frost-lock'));
  const [enemy, ally, target] = await Promise.all(['Первый противник', 'Союзник контроля', 'Цель оглушения'].map(name => request<Character>('/characters', { name })));
  const room = await request<Battle>('/battles', { name: 'Сохранение оглушения', characterId: caster.id, kind: 'team' });
  let battle = await request<Battle>(`/battles/${room.id}/join`, { characterId: enemy.id, team: 1 });
  battle = await request<Battle>(`/battles/${room.id}/join`, { characterId: ally.id, team: 0 });
  battle = await request<Battle>(`/battles/${room.id}/join`, { characterId: target.id, team: 1 });
  battle = await request<Battle>(`/battles/${room.id}/start`, { characterId: caster.id, version: battle.version });
  const repository = app.get(BattlesRepository), transactions = app.get(UnitOfWork);
  const prepare = async (id: string, element: 'physical' | 'water') => transactions.run(async context => {
    const row = await repository.lock(id, context); assert.ok(row);
    row.battle.phase = 'choose'; row.battle.matchedElements = [element]; row.battle.attributeRngState = 0;
    row.battle.fighters.find(fighter => fighter.id === row.battle.activeId)!.skillEnergy = 30;
    await repository.save(row.battle, context);
  });
  await prepare(room.id, 'water');
  battle = await request<Battle>(`/battles/${room.id}/actions`, { characterId: caster.id, version: battle.version, action: { type: 'skill', skillId: 'frost-lock', targetId: target.id } });
  assert.equal(battle.activeId, enemy.id);
  const stunned = battle.fighters.find(fighter => fighter.id === target.id)!;
  assert.equal(stunned.activeEffects![0].kind, 'stun'); assert.equal(stunned.activeEffects![0].remainingTurns, 1);
  const persisted = (await app.get(Database).sql.selectFrom('battles').select('data').where('id', '=', room.id).executeTakeFirstOrThrow()).data;
  assert.deepEqual(persisted.fighters.find(fighter => fighter.id === target.id)!.activeEffects, stunned.activeEffects);
  assert.deepEqual((await request<Battle>(`/battles/${room.id}`)).fighters.find(fighter => fighter.id === target.id)!.activeEffects, stunned.activeEffects);
  for (const actorId of [enemy.id, ally.id]) {
    await prepare(room.id, 'physical');
    battle = await request<Battle>(`/battles/${room.id}/actions`, { characterId: actorId, version: battle.version, action: { type: 'end' } });
  }
  assert.equal(battle.activeId, caster.id); assert.equal(battle.turn, 5);
  assert.equal(battle.fighters.find(fighter => fighter.id === target.id)!.activeEffects!.length, 0);
  assert.equal(battle.fighters.find(fighter => fighter.id === target.id)!.skillEnergy, 0);
  assert.ok(battle.log.some(line => line.includes('пропускает ход')));

  const hero = await request<Character>('/characters', { name: 'Снимок зелья' });
  const brewed = await request<InventoryResult>(`/characters/${hero.id}/crafting/recipes/brew-potion/apply`, { operationId: randomUUID() });
  const bottle = brewed.createdItems![0]; assert.ok(bottle.effects?.length);
  const savedBottle = await app.get(Database).sql.selectFrom('item_instances').selectAll().where('id', '=', bottle.id).executeTakeFirstOrThrow();
  assert.deepEqual(savedBottle.effects, bottle.effects);
  const potions = app.get(MongoDatabase).db.collection('items');
  const original = seedContent.items.find(item => item.id === 'potion')!.effects!;
  try {
    await potions.updateOne({ id: 'potion' }, { $set: { effects: [{ id: 'heal', recipient: 'caster', kind: 'heal', magnitude: { unit: 'hp', constant: 999, min: 0 } }] } });
    const potionRoom = await request<Battle>('/battles', { name: 'Зелье из экземпляра', characterId: hero.id, kind: 'bot' });
    let potionBattle = await request<Battle>(`/battles/${potionRoom.id}/start`, { characterId: hero.id, version: potionRoom.version });
    await transactions.run(async context => {
      const row = await repository.lock(potionRoom.id, context); assert.ok(row);
      row.battle.fighters[0].hp = 30; await repository.save(row.battle, context);
    });
    potionBattle = await request<Battle>(`/battles/${potionRoom.id}/actions`, { characterId: hero.id, version: potionBattle.version, action: { type: 'item', itemId: 'potion' } });
    assert.equal(potionBattle.fighters[0].hp, 65);
    assert.equal(potionBattle.effectResults![0].sourceItemId, 'potion');
    assert.equal(potionBattle.usedSkill, true); assert.equal(potionBattle.phase, 'before');
  } finally { await potions.updateOne({ id: 'potion' }, { $set: { effects: original } }); }
}

async function verifyBattleSession(request: TestRequest, app: INestApplication) {
  const hero = await request<Character>('/characters', { name: 'Пояс и таймер' });
  const enemy = await request<Character>('/characters', { name: 'Соперник таймера' });
  const inventory = app.get(InventoryService), database = app.get(Database), repository = app.get(BattlesRepository);
  await inventory.receive(hero.id, 'potion', 20, randomUUID());
  const initial = await inventory.get(hero.id);
  const sword = initial.items.find(item => item.itemId === 'iron-sword')!;
  await inventory.execute({ type: 'equip', instanceId: sword.id }, randomUUID());
  const room = await request<Battle>('/battles', { name: 'Жеребьёвка и пояс', characterId: hero.id, kind: 'duel' });
  const joined = await request<Battle>(`/battles/${room.id}/join`, { characterId: enemy.id, team: 1 });
  const runtime = app.get(BattleRuntime), random = runtime.random;
  runtime.random = () => 0.99;
  let battle: Battle;
  try { battle = await request<Battle>(`/battles/${room.id}/start`, { characterId: hero.id, version: joined.version }); }
  finally { runtime.random = random; }
  assert.equal(battle.activeId, enemy.id);
  assert.equal(battle.turnDurationSeconds, 30);
  assert.ok(battle.turnDeadlineAt! > Date.now() + 28000 && battle.turnDeadlineAt! <= Date.now() + 30000);
  const fighter = battle.fighters.find(fighter => fighter.id === hero.id)!;
  assert.equal(fighter.inventory.reduce((sum, stack) => sum + stack.quantity, 0), 10);
  assert.ok(fighter.inventory.every(stack => stack.instanceId));
  assert.equal(fighter.equipment?.find(item => item.id === sword.id)?.equippedSlot, 'main-hand');
  assert.ok(fighter.backpack?.some(item => item.itemId === 'potion'));
  const bottle = fighter.inventory.find(stack => stack.itemId === 'potion')!;
  await request(`/item-instances/${bottle.instanceId}/actions`, { action: 'split', quantity: 1, operationId: randomUUID() }, 409);
  // Simulate a deadline persisted before a process restart; no browser or WS drives it.
  await app.get(UnitOfWork).run(async context => {
    const row = (await repository.lock(room.id, context))!;
    row.battle.turnDeadlineAt = Date.now() - 1;
    await repository.save(row.battle, context);
  });
  await app.get(BattleTimeoutService).tick();
  await eventually(async () => (await request<Battle>(`/battles/${room.id}`)).activeId === hero.id);
  battle = await request<Battle>(`/battles/${room.id}`);
  assert.equal(battle.turn, 2);
  const deadline = battle.turnDeadlineAt;
  await app.get(UnitOfWork).run(async context => {
    const row = (await repository.lock(room.id, context))!;
    row.battle.fighters.find(fighter => fighter.id === hero.id)!.hp = 30;
    await repository.save(row.battle, context);
  });
  const beforeInventory = await inventory.get(hero.id), save = repository.save;
  const use = { characterId: hero.id, version: battle.version, action: { type: 'item', itemId: bottle.itemId, instanceId: bottle.instanceId } };
  repository.save = async () => { throw new Error('simulated battle save after potion consumption'); };
  try { await request(`/battles/${room.id}/actions`, use, 500); }
  finally { repository.save = save; }
  assert.deepEqual(await inventory.get(hero.id), beforeInventory);
  assert.equal((await request<Battle>(`/battles/${room.id}`)).version, battle.version);
  battle = await request<Battle>(`/battles/${room.id}/actions`, use);
  assert.equal(battle.turnDeadlineAt, deadline);
  assert.equal(battle.fighters.find(fighter => fighter.id === hero.id)!.hp, 65);
  assert.equal(battle.fighters.find(fighter => fighter.id === hero.id)!.inventory.reduce((sum, stack) => sum + stack.quantity, 0), 9);
  const potionCount = (view: InventoryView) => view.items.filter(item => item.itemId === 'potion').reduce((sum, item) => sum + item.quantity, 0);
  assert.equal(potionCount(await inventory.get(hero.id)), potionCount(beforeInventory) - 1);
  await request(`/battles/${room.id}/actions`, use, 409);
  assert.equal(potionCount(await inventory.get(hero.id)), potionCount(beforeInventory) - 1);
  battle = await request<Battle>(`/battles/${room.id}/actions`, { characterId: enemy.id, version: battle.version, action: { type: 'surrender' } });
  assert.equal(battle.status, 'finished'); assert.equal(battle.winner, 0); assert.equal(battle.turnDeadlineAt, undefined);
  assert.ok(battle.rewards?.some(reward => reward.characterId === hero.id));
  assert.ok(!battle.rewards?.some(reward => reward.characterId === enemy.id));
  assert.equal(potionCount(await inventory.get(hero.id)), potionCount(beforeInventory) - 1);
  const next = await request<Battle>('/battles', { name: 'Следующий пояс', characterId: hero.id, kind: 'bot' });
  const nextBattle = await request<Battle>(`/battles/${next.id}/start`, { characterId: hero.id, version: next.version });
  assert.equal(nextBattle.fighters.find(fighter => fighter.id === hero.id)!.inventory.reduce((sum, stack) => sum + stack.quantity, 0), 10);
  assert.equal(potionCount(await inventory.get(hero.id)), potionCount(beforeInventory) - 1);
  // Real PostgreSQL owner locks prevent two starts from copying the same loadout.
  await request(`/battles/${next.id}/actions`, { characterId: hero.id, version: nextBattle.version, action: { type: 'surrender' } });
  const rooms = await Promise.all(['Первый старт', 'Второй старт'].map(name => request<Battle>('/battles', { name, characterId: hero.id, kind: 'bot' })));
  const starts = await Promise.allSettled(rooms.map(room => request<Battle>(`/battles/${room.id}/start`, { characterId: hero.id, version: room.version })));
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = starts.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.actual, 409);
  assert.ok((await database.sql.selectFrom('item_instances').selectAll().where('owner_id', '=', hero.id).execute()).every(item => item.quantity > 0));
  const [leaver, teammate, foe] = await Promise.all(['Сдавшийся участник', 'Оставшийся союзник', 'Противник команды'].map(name => request<Character>('/characters', { name })));
  const team = await request<Battle>('/battles', { name: 'Сдача без остановки союзника', characterId: leaver.id, kind: 'team' });
  await request(`/battles/${team.id}/join`, { characterId: teammate.id, team: 0 });
  const teamJoined = await request<Battle>(`/battles/${team.id}/join`, { characterId: foe.id, team: 1 });
  const teamStarted = await request<Battle>(`/battles/${team.id}/start`, { characterId: leaver.id, version: teamJoined.version });
  const afterSurrender = await request<Battle>(`/battles/${team.id}/actions`, { characterId: leaver.id, version: teamStarted.version, action: { type: 'surrender' } });
  assert.equal(afterSurrender.status, 'active'); assert.equal(afterSurrender.activeId, foe.id);
  const leaverInventory = await inventory.get(leaver.id);
  assert.equal(leaverInventory.items.find(item => item.itemId === 'iron-sword')!.actions.find(action => action.id === 'equip')!.enabled, true);
  const personal = await request<Battle>('/battles', { name: 'После сдачи', characterId: leaver.id, kind: 'bot' });
  await request(`/battles/${personal.id}/start`, { characterId: leaver.id, version: personal.version });
}

async function verifyIdentity(origin: string, request: TestRequest, accounts: Account[], primaryToken: string, app: INestApplication) {
  const call = async (path: string, token?: string, body?: object, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${origin}/api/v1${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call('/characters')).status, 401);
  assert.equal((await call('/characters', accounts[0].id)).status, 401);
  const otherLogin = await call('/identity/session', undefined, { accountId: accounts[1].id });
  assert.equal(otherLogin.status, 201);
  const otherToken = otherLogin.data.token as string;
  const first = await request<Character[]>('/characters');
  const second = (await call('/characters', otherToken)).data as Character[];
  assert.equal(first.length, 5); assert.equal(second.length, 5);
  assert.ok(first.every(hero => hero.accountId === accounts[0].id));
  assert.ok(second.every(hero => hero.accountId === accounts[1].id));
  assert.ok(first.every(hero => !second.some(other => other.id === hero.id)));
  const own = first[0], foreign = second[0];
  for (const path of [`/characters/${foreign.id}`, `/characters/${foreign.id}/skills`, `/characters/${foreign.id}/inventories`, `/characters/${foreign.id}/inventory`, `/characters/${foreign.id}/crafting`, `/characters/${foreign.id}/gathering`]) {
    assert.equal((await call(path, primaryToken)).status, 403, path);
  }
  assert.equal((await call(`/characters/${foreign.id}/skills`, primaryToken, { skillId: 'ember' })).status, 403);
  assert.equal((await call(`/characters/${foreign.id}/gathering/actions`, primaryToken, { operationId: randomUUID(), expectedRevision: 0, action: { type: 'return' } })).status, 403);
  assert.equal((await call(`/characters/${foreign.id}/attributes`, primaryToken, { allocations: { strength: 1 }, expectedRevision: 0 })).status, 403);
  assert.equal((await call('/identity/session/character', primaryToken, { characterId: foreign.id })).status, 403);
  assert.equal((await request<{ characterId: string | null }>('/identity/session')).characterId, null);
  const selected = await request<{ characterId: string }>('/identity/session/character', { characterId: own.id });
  assert.equal(selected.characterId, own.id);
  assert.equal((await request<{ characterId: string }>('/identity/session')).characterId, own.id);
  assert.equal((await call('/identity/session', otherToken)).data.characterId, null);
  const another = await request<AccountLogin>('/identity/session', { accountId: accounts[0].id });
  assert.equal(another.characterId, null); assert.notEqual(another.token, primaryToken);
  assert.equal((await call('/identity/session', primaryToken)).data.characterId, own.id);
  const foreignInventory = (await call(`/characters/${foreign.id}/inventories`, otherToken)).data as InventoryView;
  const ownInventory = await request<InventoryView>(`/characters/${own.id}/inventories`);
  const item = foreignInventory.items[0], ownItem = ownInventory.items[0];
  assert.equal((await call(`/item-instances/${item.id}`, primaryToken)).status, 403);
  assert.equal((await call(`/item-instances/${item.id}/actions`, primaryToken, { action: 'split', quantity: 1, operationId: randomUUID() })).status, 403);
  assert.equal((await call('/inventory-transfers', primaryToken, { instanceId: ownItem.id, targetInventoryId: foreign.id, quantity: 1, operationId: randomUUID() })).status, 403);
  assert.equal((await call(`/inventories/${foreign.id}/items`, primaryToken, { instanceId: ownItem.id, quantity: 1, operationId: randomUUID() })).status, 403);
  assert.equal((await call(`/item-instances/${ownItem.id}/actions`, primaryToken, { action: 'merge', targetInstanceId: item.id, operationId: randomUUID() })).status, 403);
  assert.deepEqual((await call(`/characters/${foreign.id}/inventories`, otherToken)).data, foreignInventory);
  assert.equal((await call('/characters', primaryToken, { name: 'Подмена владельца', accountId: accounts[1].id })).status, 400);
  assert.equal((await call('/battles', primaryToken, { name: 'Чужой герой', characterId: foreign.id, kind: 'bot' })).status, 403);
  const foreignRoom = await call('/battles', otherToken, { name: 'Бой другого аккаунта', characterId: foreign.id, kind: 'bot' });
  assert.equal(foreignRoom.status, 201);
  for (const action of ['join', 'start', 'actions']) {
    assert.equal((await call(`/battles/${foreignRoom.data.id}/${action}`, primaryToken, { characterId: foreign.id, version: foreignRoom.data.version, team: 0, action: { type: 'surrender' } })).status, 403);
  }
  assert.equal((await call('/identity/session', otherToken, undefined, 'DELETE')).status, 200);
  assert.equal((await call('/characters', otherToken)).status, 401);
  const again = (await call('/identity/session', undefined, { accountId: accounts[1].id })).data as AccountLogin;
  assert.equal(again.characterId, null);
  const db = app.get(Database);
  const savedSessions = await db.sql.selectFrom('account_sessions').selectAll().execute();
  assert.ok(savedSessions.every(session => /^[a-f0-9]{64}$/.test(session.token_hash) && session.token_hash !== primaryToken && session.token_hash !== again.token));
  await db.sql.updateTable('account_sessions').set({ expires_at: new Date(Date.now() - 1) }).where('account_id', '=', accounts[1].id).execute();
  assert.equal((await call('/identity/session', again.token)).status, 401);
  assert.equal((await call('/accounts', undefined, { name: accounts[0].name.toLowerCase() })).status, 409);
  const created = await call('/accounts', undefined, { name: 'Новый аккаунт' });
  assert.equal(created.status, 201);
  const newLogin = (await call('/identity/session', undefined, { accountId: created.data.id })).data as AccountLogin;
  assert.deepEqual((await call('/characters', newLogin.token)).data, []);
  const newHero = await call('/characters', newLogin.token, { name: 'Собственный герой' });
  assert.equal(newHero.status, 201); assert.equal(newHero.data.accountId, created.data.id);
  assert.equal((await call(`/characters/${newHero.data.id}`, primaryToken)).status, 403);
  assert.equal((await call('/characters', newLogin.token)).data.length, 1);
  const unauthenticated = io(origin, { autoConnect: false, reconnection: false });
  try {
    await new Promise<void>((resolve, reject) => { unauthenticated.on('connect', resolve); unauthenticated.on('connect_error', reject); unauthenticated.connect(); });
    const result = await new Promise<{ error?: string }>(resolve => unauthenticated.emit('watch', foreignRoom.data.id, resolve));
    assert.equal(result.error, 'Выберите аккаунт');
  } finally { unauthenticated.disconnect(); }
}
