import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { sql } from 'kysely';
import { createCharacter, seedContent } from '@game/core';
import { Database } from '../src/infrastructure/database/database.service';

test('the single v1 init creates the complete schema, seeds heroes and preserves progress on restart', async () => {
  const connection = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? 'postgres://game:game@127.0.0.1:5432/game';
  const admin = new Pool({ connectionString: connection });
  const databaseName = `game_init_${randomUUID().replaceAll('-', '')}`;
  const previous = process.env.POSTGRES_URL;
  let database: Database | undefined, created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    const isolated = new URL(connection); isolated.pathname = '/' + databaseName;
    process.env.POSTGRES_URL = isolated.toString();
    database = new Database(); await database.onModuleInit();
    const migrations = await sql<{ name: string }>`select name from kysely_migration`.execute(database.sql);
    assert.deepEqual(migrations.rows.map(row => row.name), ['init']);
    const initial = await database.sql.selectFrom('characters').selectAll().execute();
    assert.equal(initial.length, 10);
    assert.ok(initial.every(row => row.data.level === 10 && row.data.learnedSkillIds.length >= 6 && row.data.stats.maxEnergy === 30));
    for (const table of ['battles', 'battle_rewards', 'battle_archive_outbox', 'inventory_operations', 'crafting_operations'] as const) {
      assert.equal((await database.sql.selectFrom(table).selectAll().execute()).length, 0);
    }
    const inventories = await database.sql.selectFrom('inventories').selectAll().execute();
    assert.equal(inventories.length, 10); assert.ok(inventories.every(value => value.is_primary && value.capacity === 50));
    const items = await database.sql.selectFrom('item_instances').selectAll().execute();
    assert.ok(items.every(item => item.quality === null && item.item_level === 1 && item.definition_version === 1));
    for (const character of initial) for (const stack of character.data.inventory) {
      const instances = items.filter(item => item.owner_id === character.id && item.item_id === stack.itemId);
      assert.equal(instances.reduce((sum, item) => sum + item.quantity, 0), stack.quantity);
    }
    const firstItem = items[0];
    for (const item_level of [0, 1001]) await assert.rejects(database.sql.updateTable('item_instances').set({ item_level }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ definition_version: 0 }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ quantity: 0 }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ quality: '{}', quantity: 2 }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.insertInto('inventories').values({ id: randomUUID(), owner_id: initial[0].id, name: 'Повторный основной', capacity: 50, is_primary: true }).execute());
    const progressed = { ...initial[0].data, name: 'Сохранённый герой', experience: 77 };
    await database.sql.updateTable('characters').set({ data: JSON.stringify(progressed) }).where('id', '=', progressed.id).execute();
    const custom = createCharacter(randomUUID(), 'Свой герой', seedContent);
    await database.sql.insertInto('characters').values({ id: custom.id, data: JSON.stringify(custom) }).execute();
    await database.onApplicationShutdown();
    database = new Database(); await database.onModuleInit();
    const after = await database.sql.selectFrom('characters').selectAll().execute();
    assert.equal(after.length, 11);
    assert.deepEqual(after.find(row => row.id === progressed.id)?.data, progressed);
    assert.deepEqual(after.find(row => row.id === custom.id)?.data, custom);
    assert.deepEqual(await database.sql.selectFrom('item_instances').selectAll().orderBy('id').execute(), [...items].sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = previous;
    await database?.onApplicationShutdown();
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
