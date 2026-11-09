import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { Pool } from 'pg';
import { cargoOfferSchema, type WorldTool, type WorldView, type WorldDelivery, type StartWorldRequest, type ExecuteWorldRequest } from '@game/core';
import { RabbitRpc, MessageFailure } from '@game/messaging';
import { removeTestQueues } from '@game/messaging/testing';
import { Database } from '../../server/src/infrastructure/database/database.service';
import type { WorldCommandResult, WorldIdentity } from '../src/shared/application/world-contracts';
import { canonicalJson } from '../src/shared/application/canonical-json';

test('PostgreSQL world service: process restart, concurrent commands, atomic rollback and durable cargo', { timeout: 120000 }, async t => {
  const adminUrl = process.env.TEST_POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  const suffix = randomUUID().replaceAll('-', '');
  const databaseName = `game_world_${suffix}`, roleName = `world_${suffix}`;
  const token = randomBytes(32).toString('hex'), password = randomBytes(24).toString('hex');
  const rabbitUrl = process.env.TEST_RABBITMQ_URL ?? 'amqp://game:game@127.0.0.1:5672', rabbitNamespace = `test-world-${suffix}`;
  const rpc = new RabbitRpc({ producer: 'server', url: () => rabbitUrl, secret: () => token, namespace: () => rabbitNamespace, timeoutMs: 10000 });
  rpc.handle('inventory.import-expedition-cargo', 'world', async raw => {
    const offer = cargoOfferSchema.parse(raw), manifest = offer.manifest;
    return { manifestId: manifest.id, worldId: manifest.worldId, playerId: manifest.playerId, characterId: manifest.characterId,
      hash: offer.hash, status: 'available', reason: 'Standalone world storage test' };
  });
  const isolated = new URL(adminUrl); isolated.pathname = '/' + databaseName;
  let owner: Pool | undefined, limited: Pool | undefined, migration: Database | undefined;
  let createdDatabase = false, createdRole = false;
  const children = new Set<ChildProcess>();
  let baseUrl = '';
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) { children.delete(child); return; }
    const exited = once(child, 'exit');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.kill('SIGTERM');
    try { await exited; } finally { clearTimeout(deadline); children.delete(child); }
  };
  const start = async (connection: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: process.cwd(), env: { ...process.env, WORLD_POSTGRES_URL: connection, WORLD_SERVICE_TOKEN: token, WORLD_PORT: '0', WORLD_HOST: '127.0.0.1',
        RABBITMQ_URL: rabbitUrl, RABBITMQ_NAMESPACE: rabbitNamespace },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let output = '';
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`World startup timed out: ${output}`)); }, 15000);
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
        const match = output.match(/WORLD_LISTENING (\d+)/);
        if (match && !ready) { ready = true; clearTimeout(timer); baseUrl = `http://127.0.0.1:${match[1]}/api/v1/world`; resolve(); }
      };
      child.stdout!.on('data', read); child.stderr!.on('data', read);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); if (!ready) reject(new Error(`World exited (${code}): ${output}`)); });
    });
    return child;
  };
  async function wire<T>(path: string, method = 'GET', body?: unknown, expected = 200, key = token): Promise<T> {
    const response = await fetch(baseUrl + path, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result as T;
  }
  const actor: WorldIdentity = { playerId: randomUUID(), characterId: randomUUID(), membershipId: randomUUID(), partyId: randomUUID() };
  const member: WorldIdentity = { ...actor, playerId: randomUUID(), characterId: randomUUID(), membershipId: randomUUID() };
  const worldId = randomUUID();
  const query = (identity = actor) => new URLSearchParams({ ...identity }).toString();
  const state = (identity = actor) => request<WorldView>(`/expeditions/${worldId}?${query(identity)}`);
  const act = (body: unknown, expected = 201) => request<WorldCommandResult>(`/expeditions/${worldId}/actions`, 'POST', body, expected);
  const members = [actor, member].map(({ partyId: _, ...entry }) => entry);
  const startRequest = { worldId, operationId: randomUUID(), actor, members };
  const issued = new Map<string, { id: string; sequence: number }>(), sequences = new Map<string, number>();
  async function dispatch(targetWorld: string, body: StartWorldRequest | ExecuteWorldRequest, isStart = false, key = token) {
    const subject = isStart ? (body as StartWorldRequest).actor : (body as ExecuteWorldRequest).actor;
    const operationId = isStart ? (body as StartWorldRequest).operationId : (body as ExecuteWorldRequest).command.operationId;
    const admissionKey = `${targetWorld}:${subject.playerId}:${operationId}`;
    if (!issued.has(admissionKey)) {
      const sequence = 1 + (sequences.get(targetWorld) ?? 0); sequences.set(targetWorld, sequence);
      issued.set(admissionKey, { id: randomUUID(), sequence });
    }
    const party = { id: actor.partyId, revision: 1, leaderPlayerId: actor.playerId, members };
    const envelope: WorldDelivery = { ...issued.get(admissionKey)!, worldId: targetWorld, payload: isStart
      ? { kind: 'start', actor: subject, operationId, party } : { kind: 'action', request: body as ExecuteWorldRequest, party } };
    if ('seed' in body) Object.assign(envelope, { seed: body.seed });
    try { return await rpc.request('world', 'world.deliver', envelope.id, envelope) as { status: number; body: unknown }; }
    catch (error) {
      const failure = error as MessageFailure;
      return { status: failure.retryable ? 503 : failure.code === 'HTTP_409' ? 409 : 400, body: { message: failure.message } };
    }
  }
  async function request<T>(path: string, method = 'GET', body?: unknown, expected = 200, key = token): Promise<T> {
    if (method === 'POST' && (path === '/expeditions' || path.endsWith('/actions'))) {
      const isStart = path === '/expeditions', targetWorld = isStart ? (body as StartWorldRequest).worldId : path.split('/')[2];
      const result = await dispatch(targetWorld, body as StartWorldRequest | ExecuteWorldRequest, isStart, key);
      assert.equal(result.status, expected, JSON.stringify(result.body)); return result.body as T;
    }
    if (path.includes('/manifests?')) {
      const url = new URL(path, 'http://internal');
      path = `${url.pathname}?${new URLSearchParams({ playerId: url.searchParams.get('playerId')!, characterId: url.searchParams.get('characterId')! })}`;
    }
    return wire<T>(path, method, body, expected, key);
  }
  const makeCommand = (revision: number, action: unknown, identity = actor, tool?: WorldTool) => ({ actor: identity,
    command: { operationId: randomUUID(), expectedRevision: revision, action }, ...(tool ? { tool } : {}) });
  const shovel = { instanceId: randomUUID(), ownerCharacterId: actor.characterId, toolClassId: 'shovel' };
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`); createdDatabase = true;
    const previous = process.env.POSTGRES_URL;
    try { process.env.POSTGRES_URL = isolated.toString(); migration = new Database(); }
    finally { if (previous === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = previous; }
    await migration.onModuleInit(); await migration.onApplicationShutdown(); migration = undefined;
    owner = new Pool({ connectionString: isolated.toString() });
    const roleCommand = await admin.query<{ command: string }>("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS command", [roleName, password]);
    await admin.query(roleCommand.rows[0].command); createdRole = true;
    await owner.query(`GRANT USAGE ON SCHEMA world TO "${roleName}"`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON world.instances, world.geometry, world.regions, world.members, world.progress, world.cargo_outbox TO "${roleName}"`);
    await owner.query(`GRANT SELECT, INSERT ON world.operations, world.manifests, world.deliveries TO "${roleName}"`);
    const restricted = new URL(isolated); restricted.username = roleName; restricted.password = password;
    limited = new Pool({ connectionString: restricted.toString() });
    await assert.rejects(limited.query('SELECT * FROM public.characters'), { code: '42501' });
    await assert.rejects(limited.query('CREATE TABLE world.forbidden(id integer)'), { code: '42501' });
    await assert.rejects(limited.query('DELETE FROM world.operations'), { code: '42501' });
    await assert.rejects(limited.query('UPDATE world.manifests SET hash=hash'), { code: '42501' });
    let child = await start(restricted.toString());

    await t.test('internal authorization, strict DTOs, start replay and one active world per party', async () => {
      await request('/health');
      await wire(`/expeditions/${worldId}?${query()}`, 'GET', undefined, 401, 'wrong-key');
      await request('/expeditions', 'POST', { ...startRequest, seed: 1 }, 400);
      const created = await request<WorldCommandResult>('/expeditions', 'POST', startRequest, 201);
      assert.deepEqual(await request('/expeditions', 'POST', startRequest, 201), created);
      await request('/expeditions', 'POST', { ...startRequest, worldId: randomUUID(), operationId: randomUUID() }, 409);
      await request(`/expeditions/${worldId}?${query({ ...actor, membershipId: randomUUID() })}`, 'GET', undefined, 403);
    });

    let minedRequest: ReturnType<typeof makeCommand>, minedResult: WorldCommandResult, minedView: WorldView;
    await t.test('simultaneous entry persists exactly one region and simultaneous mining grants once', async () => {
      const entries = await Promise.all([0, 1].map(() => dispatch(worldId, makeCommand(0, { type: 'enter' }) as ExecuteWorldRequest)));
      assert.deepEqual(entries.map(entry => entry.status).sort(), [201, 409]);
      assert.equal((await owner!.query('SELECT count(*) FROM world.regions WHERE world_id=$1', [worldId])).rows[0].count, '1');
      const view = await state(), p = view.location!.position!;
      minedRequest = makeCommand(view.revision, { type: 'harvest', position: { ...p, y: p.y - 1 }, toolInstanceId: shovel.instanceId }, actor, shovel);
      const competitor = structuredClone(minedRequest); competitor.actor = member;
      competitor.command.operationId = randomUUID(); competitor.tool = { ...shovel, ownerCharacterId: member.characterId };
      const replies = await Promise.all([minedRequest, competitor].map(body => dispatch(worldId, body as ExecuteWorldRequest)));
      assert.deepEqual(replies.map(reply => reply.status).sort(), [201, 409]);
      const winner = replies.findIndex(reply => reply.status === 201);
      if (winner === 1) { minedRequest = competitor; }
      minedResult = replies[winner].body as WorldCommandResult;
      minedView = await state(minedRequest.actor);
      assert.equal(minedView.xp, 1); assert.equal((await state()).xp + (await state(member)).xp, 1);
      assert.deepEqual(await act(minedRequest), minedResult);
      const changed = structuredClone(minedRequest); changed.tool!.toolClassId = 'axe'; await act(changed, 409);
      const stored = (await owner!.query('SELECT result, rolls FROM world.operations WHERE world_id=$1 AND operation_id=$2', [worldId, minedRequest.command.operationId])).rows[0];
      assert.ok(stored.rolls.length > 0); assert.equal('rolls' in stored.result.outcome, false);
    });

    await t.test('actual process restart restores block changes, cargo, XP and old command responses', async () => {
      await stop(child); child = await start(restricted.toString());
      assert.deepEqual(await state(minedRequest.actor), minedView);
      assert.deepEqual(await act(minedRequest), minedResult);
      const before = (await owner!.query('SELECT data FROM world.regions WHERE world_id=$1', [worldId])).rows[0].data;
      const view = await state(); await act(makeCommand(view.revision, { type: 'leave' }));
      await act(makeCommand(view.revision + 1, { type: 'enter' }));
      assert.deepEqual((await owner!.query('SELECT data FROM world.regions WHERE world_id=$1', [worldId])).rows[0].data, before);
    });

    await t.test('a real database error after mutation rolls back geometry, cargo, XP, RNG and receipt', async () => {
      await owner!.query("CREATE FUNCTION world.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$");
      await owner!.query('CREATE TRIGGER reject_receipt BEFORE INSERT ON world.operations FOR EACH ROW EXECUTE FUNCTION world.reject_receipt()');
      const view = await state(), p = view.location!.position!;
      const type = view.region!.blocks.find(block => block.position.x === p.x && block.position.z === p.z && block.position.y === p.y - 1)!.blockId;
      const tool = { ...shovel, toolClassId: type === 'stone' || type === 'copper-vein' ? 'pickaxe' : 'shovel' };
      const requestBody = makeCommand(view.revision, { type: 'harvest', position: { ...p, y: p.y - 1 }, toolInstanceId: tool.instanceId }, actor, tool);
      const before = (await owner!.query('SELECT data FROM world.instances WHERE id=$1', [worldId])).rows[0].data;
      const region = (await owner!.query('SELECT data FROM world.regions WHERE world_id=$1', [worldId])).rows[0].data;
      await act(requestBody, 503);
      assert.deepEqual(await state(), view);
      assert.deepEqual((await owner!.query('SELECT data FROM world.instances WHERE id=$1', [worldId])).rows[0].data, before);
      assert.deepEqual((await owner!.query('SELECT data FROM world.regions WHERE world_id=$1', [worldId])).rows[0].data, region);
      assert.equal((await owner!.query('SELECT count(*) FROM world.operations WHERE operation_id=$1', [requestBody.command.operationId])).rows[0].count, '0');
      await owner!.query('DROP TRIGGER reject_receipt ON world.operations');
      await owner!.query('DROP FUNCTION world.reject_receipt()');
      assert.equal((await act(requestBody)).outcome.xpGained, 1);
    });

    await t.test('closing deletes geometry but preserves independent cargo manifests, XP and repeat receipts across restart', async () => {
      const before = await state(), beforeOther = await state(member);
      const close = makeCommand(before.revision, { type: 'close' });
      // Failure while sealing must also restore the already-deleted regions.
      await owner!.query("CREATE FUNCTION world.reject_manifest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected manifest failure'; END $$");
      await owner!.query('CREATE TRIGGER reject_manifest BEFORE INSERT ON world.manifests FOR EACH ROW EXECUTE FUNCTION world.reject_manifest()');
      await act(close, 503); assert.deepEqual(await state(), before);
      await owner!.query('DROP TRIGGER reject_manifest ON world.manifests'); await owner!.query('DROP FUNCTION world.reject_manifest()');
      const result = await act(close);
      await stop(child); child = await start(restricted.toString());
      assert.deepEqual(await act(close), result); assert.deepEqual(await act(minedRequest), minedResult);
      for (const table of ['geometry', 'regions']) assert.equal((await owner!.query(`SELECT count(*) FROM world.${table} WHERE world_id=$1`, [worldId])).rows[0].count, '0');
      for (const [who, previousView] of [[actor, before], [member, beforeOther]] as const) {
        const manifests = await request<{ cargo: unknown; playerId: string }[]>(`/expeditions/${worldId}/manifests?${query(who)}`);
        if (previousView.cargo.length) { assert.deepEqual(manifests[0].cargo, previousView.cargo); assert.equal(manifests[0].playerId, who.playerId); }
        else assert.deepEqual(manifests, []);
        const closed = await state(who); assert.equal(closed.xp, previousView.xp); assert.deepEqual(closed.cargo, []); assert.equal(closed.status, 'closed');
      }
      await act(makeCommand(result.revision, { type: 'enter' }), 400);
      const receiptRows = (await owner!.query('SELECT result FROM world.operations WHERE world_id=$1', [worldId])).rows;
      assert.ok(receiptRows.every(row => !JSON.stringify(row.result).includes('"blocks"') && !JSON.stringify(row.result).includes('"seed"')));
      for (const row of (await owner!.query('SELECT data, hash FROM world.manifests WHERE world_id=$1', [worldId])).rows)
        assert.equal(createHash('sha256').update(canonicalJson(row.data)).digest('hex'), row.hash);
      const next = { ...startRequest, worldId: randomUUID(), operationId: randomUUID() };
      await request('/expeditions', 'POST', next, 201);
      const newView = await request<WorldView>(`/expeditions/${next.worldId}?${query()}`);
      assert.equal(newView.xp, before.xp); assert.deepEqual(newView.cargo, []);
    });
  } finally {
    for (const child of children) await stop(child);
    await rpc.close(); await removeTestQueues(rabbitUrl, rabbitNamespace);
    if (migration) await migration.onApplicationShutdown();
    if (limited) await limited.end(); if (owner) await owner.end();
    if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    if (createdRole) await admin.query(`DROP ROLE "${roleName}"`);
    await admin.end();
  }
});
