import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createCharacter, newBattle, seedContent } from '@game/core';
import { Migrator } from 'kysely';
import { Database } from '../src/infrastructure/database/database.service';
import { demoCharactersMigration } from '../src/infrastructure/database/migrations/003-demo-characters';
import { initialMigration } from '../src/infrastructure/database/migrations/001-initial';
import { progressionRewardsMigration } from '../src/infrastructure/database/migrations/002-progression-rewards';

test('fresh database migrates, seeds level 10 heroes and preserves progress on restart and replay', async () => {
  const connection = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const admin = new Pool({ connectionString: connection });
  const databaseName = `game_migrations_${randomUUID().replaceAll('-', '')}`;
  const previous = process.env.POSTGRES_URL;
  let database: Database | undefined;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const isolated = new URL(connection); isolated.pathname = '/' + databaseName;
    process.env.POSTGRES_URL = isolated.toString();
    database = new Database(); await database.onModuleInit();
    const initial = await database.sql.selectFrom('characters').selectAll().execute();
    assert.equal(initial.length, 10);
    assert.ok(initial.every(row => row.data.level === 10 && row.data.learnedSkillIds.length >= 6));
    const progressed = { ...initial[0].data, name: 'Сохранённый герой', experience: 77 };
    await database.sql.updateTable('characters').set({ data: JSON.stringify(progressed) }).where('id', '=', progressed.id).execute();
    const custom = createCharacter(randomUUID(), 'Свой герой', seedContent);
    await database.sql.insertInto('characters').values({ id: custom.id, data: JSON.stringify(custom) }).execute();
    await database.onApplicationShutdown();
    database = new Database(); await database.onModuleInit();
    await demoCharactersMigration.up(database.sql);
    const after = await database.sql.selectFrom('characters').selectAll().execute();
    assert.equal(after.length, 11);
    assert.deepEqual(after.find(c => c.id === progressed.id)?.data, progressed);
    assert.deepEqual(after.find(c => c.id === custom.id)?.data, custom);
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = previous;
    await database?.onApplicationShutdown();
    // Only this test's freshly created database is removed.
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end();
  }
});

test('upgrading the previous schema keeps battle snapshots and stages existing victories for archiving', async () => {
  const connection = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const admin = new Pool({ connectionString: connection });
  const databaseName = `game_upgrade_${randomUUID().replaceAll('-', '')}`;
  const previous = process.env.POSTGRES_URL;
  let database: Database | undefined;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const isolated = new URL(connection); isolated.pathname = '/' + databaseName;
    process.env.POSTGRES_URL = isolated.toString();
    database = new Database();
    const legacy = new Migrator({ db: database.sql, provider: { getMigrations: async () => ({
      '001_initial': initialMigration, '002_progression_rewards': progressionRewardsMigration,
      '003_demo_characters': demoCharactersMigration,
    }) } });
    const result = await legacy.migrateToLatest();
    if (result.error) throw result.error;
    const character = (await database.sql.selectFrom('characters').select('data').executeTakeFirstOrThrow()).data;
    const completed = newBattle(randomUUID(), 'Старый бой', 'bot', 'before', character, seedContent);
    completed.status = 'finished'; completed.winner = 0; completed.version = 7;
    const active = newBattle(randomUUID(), 'Старое лобби', 'bot', 'before', character, seedContent);
    for (const battle of [completed, active]) {
      await database.sql.insertInto('battles').values({ id: battle.id, version: battle.version, data: JSON.stringify(battle) }).execute();
    }
    await database.onModuleInit();
    const staged = await database.sql.selectFrom('battle_archive_outbox').selectAll().execute();
    assert.equal(staged.length, 1);
    assert.deepEqual(staged[0].data, completed);
    assert.equal(staged[0].delivered_at, null);
    assert.equal((await database.sql.selectFrom('battles').selectAll().execute()).length, 2);
    assert.equal((await database.sql.selectFrom('characters').selectAll().execute()).length, 10);
    await database.onModuleInit();
    assert.equal((await database.sql.selectFrom('battle_archive_outbox').selectAll().execute()).length, 1);
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = previous;
    await database?.onApplicationShutdown();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
