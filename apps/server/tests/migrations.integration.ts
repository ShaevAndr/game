import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { sql } from 'kysely';
import { createCharacter, demoAccounts, seedContent } from '@game/core';
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
    for (const table of ['instances', 'geometry', 'regions', 'members', 'progress', 'operations', 'manifests', 'deliveries', 'cargo_outbox']) {
      const result = await sql<{ count: string }>`SELECT count(*) FROM ${sql.table('world.' + table)}`.execute(database.sql);
      assert.equal(result.rows[0].count, '0');
    }
    const worldForeignKeys = await sql<{ target_schema: string }>`
      SELECT foreign_namespace.nspname AS target_schema FROM pg_constraint constraint_row
      JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class foreign_table ON foreign_table.oid = constraint_row.confrelid
      JOIN pg_namespace foreign_namespace ON foreign_namespace.oid = foreign_table.relnamespace
      WHERE constraint_row.contype = 'f' AND source_namespace.nspname = 'world'
    `.execute(database.sql);
    assert.ok(worldForeignKeys.rows.length > 0);
    assert.ok(worldForeignKeys.rows.every(row => row.target_schema === 'world'));
    const initial = await database.sql.selectFrom('characters').selectAll().execute();
    for (const table of ['world_cargo_imports', 'world_cargo_operations', 'world_cargo_ack_outbox'] as const) {
      assert.equal((await database.sql.selectFrom(table).selectAll().execute()).length, 0);
    }
    assert.equal(initial.length, 10);
    assert.equal((await database.sql.selectFrom('accounts').selectAll().execute()).length, 2);
    for (const account of demoAccounts) assert.equal(initial.filter(row => row.account_id === account.id).length, 5);
    assert.ok(initial.every(row => row.data.accountId === row.account_id));
    assert.ok(initial.every(row => row.data.level === 10 && row.data.learnedSkillIds.length >= 6 && row.data.stats.maxEnergy === 30));
    for (const table of ['battles', 'battle_rewards', 'battle_archive_outbox', 'inventory_operations', 'inventory_world_reservations', 'world_journal_worlds', 'world_journal_entries', 'crafting_operations', 'gathering_states', 'gathering_operations', 'parties', 'party_members', 'party_invitations', 'party_operations', 'social_players', 'social_pairs', 'social_operations', 'chat_streams', 'chat_messages', 'chat_deliveries', 'chat_operations'] as const) {
      assert.equal((await database.sql.selectFrom(table).selectAll().execute()).length, 0);
    }
    const inventories = await database.sql.selectFrom('inventories').selectAll().execute();
    assert.equal(inventories.length, 10); assert.ok(inventories.every(value => value.is_primary && value.capacity === 50));
    const items = await database.sql.selectFrom('item_instances').selectAll().execute();
    assert.ok(items.every(item => item.quality === null && item.item_level === 1 && item.definition_version === 1));
    for (const character of initial) for (const stack of character.data.inventory) {
      const instances = items.filter(item => item.owner_id === character.id && item.item_id === stack.itemId);
      assert.equal(instances.reduce((sum, item) => sum + item.quantity, 0), stack.quantity);
      if (stack.effects) assert.ok(instances.every(item => JSON.stringify(item.effects) === JSON.stringify(stack.effects)));
    }
    const firstItem = items[0];
    for (const item_level of [0, 1001]) await assert.rejects(database.sql.updateTable('item_instances').set({ item_level }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ definition_version: 0 }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ effects: '{}' }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ quantity: 0 }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.updateTable('item_instances').set({ quality: '{}', quantity: 2 }).where('id', '=', firstItem.id).execute());
    await assert.rejects(database.sql.insertInto('inventories').values({ id: randomUUID(), owner_id: initial[0].id, name: 'Повторный основной', capacity: 50, is_primary: true }).execute());
    const progressed = { ...initial[0].data, name: 'Сохранённый герой', experience: 77 };
    await database.sql.updateTable('characters').set({ data: JSON.stringify(progressed) }).where('id', '=', progressed.id).execute();
    const custom = { ...createCharacter(randomUUID(), 'Свой герой', seedContent), accountId: demoAccounts[0].id };
    await database.sql.insertInto('characters').values({ id: custom.id, account_id: custom.accountId, data: JSON.stringify(custom) }).execute();
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
