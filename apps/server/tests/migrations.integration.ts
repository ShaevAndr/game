import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createCharacter, seedContent } from '@game/core';
import { Database } from '../src/database/database.module';
import { demoCharactersMigration } from '../src/database/migrations/003-demo-characters';

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
    await database.onModuleDestroy();
    database = new Database(); await database.onModuleInit();
    await demoCharactersMigration.up(database.sql);
    const after = await database.sql.selectFrom('characters').selectAll().execute();
    assert.equal(after.length, 11);
    assert.deepEqual(after.find(c => c.id === progressed.id)?.data, progressed);
    assert.deepEqual(after.find(c => c.id === custom.id)?.data, custom);
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = previous;
    await database?.onModuleDestroy();
    // Only this test's freshly created database is removed.
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end();
  }
});
