import { randomUUID } from 'node:crypto';
import { Migration, sql } from 'kysely';
import { seedContent, consumableEffects, demoAccounts } from '@game/core';
import characters from '../seeds/demo-characters.json';

/** Pre-release v1 baseline. Schema changes belong here until a new release is explicitly started. */
export const initialMigration: Migration = {
  async up(db) {
    await db.schema.createTable('accounts').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('name', 'varchar(32)', c => c.notNull())
      .addColumn('created_at', 'timestamptz', c => c.notNull()).execute();
    await sql`CREATE UNIQUE INDEX accounts_name ON accounts (lower(name))`.execute(db);
    for (const account of demoAccounts) await db.insertInto('accounts').values({ id: account.id, name: account.name, created_at: new Date(account.createdAt) }).execute();
    await db.schema.createTable('characters').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('account_id', 'uuid', c => c.notNull().references('accounts.id'))
      .addColumn('data', 'jsonb', c => c.notNull()).execute();
    await db.schema.createIndex('characters_account').on('characters').column('account_id').execute();
    await db.schema.createTable('account_sessions').addColumn('token_hash', 'varchar(64)', c => c.primaryKey())
      .addColumn('account_id', 'uuid', c => c.notNull().references('accounts.id'))
      .addColumn('character_id', 'uuid', c => c.references('characters.id').onDelete('set null'))
      .addColumn('expires_at', 'timestamptz', c => c.notNull()).execute();
    await db.schema.createIndex('account_sessions_expiry').on('account_sessions').column('expires_at').execute();
    await db.schema.createTable('social_players').addColumn('player_id', 'uuid', c => c.primaryKey())
      .addColumn('revision', 'integer', c => c.notNull().defaultTo(0))
      .addColumn('visibility_revision', 'integer', c => c.notNull().defaultTo(0)).execute();
    await db.schema.createTable('social_pairs').addColumn('low_id', 'uuid', c => c.notNull())
      .addColumn('high_id', 'uuid', c => c.notNull()).addColumn('data', 'jsonb', c => c.notNull())
      .addPrimaryKeyConstraint('social_pair_players', ['low_id', 'high_id']).execute();
    await db.schema.createIndex('social_pairs_high').on('social_pairs').column('high_id').execute();
    await db.schema.createTable('social_operations').addColumn('player_id', 'uuid', c => c.notNull())
      .addColumn('operation_id', 'uuid', c => c.notNull()).addColumn('signature', 'text', c => c.notNull())
      .addColumn('result', 'jsonb').addPrimaryKeyConstraint('social_operation_player', ['player_id', 'operation_id']).execute();
    await db.schema.createTable('chat_streams').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('stream_key', 'varchar(160)', c => c.notNull().unique())
      .addColumn('last_sequence', 'integer', c => c.notNull().defaultTo(0)).execute();
    await db.schema.createTable('chat_messages').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('sender_id', 'uuid', c => c.notNull())
      .addColumn('created_at', 'timestamptz', c => c.notNull())
      .addColumn('data', 'jsonb', c => c.notNull()).execute();
    await db.schema.createIndex('chat_sender_time').on('chat_messages').columns(['sender_id', 'created_at']).execute();
    await db.schema.createTable('chat_deliveries')
      .addColumn('stream_id', 'uuid', c => c.notNull().references('chat_streams.id'))
      .addColumn('sequence', 'integer', c => c.notNull())
      .addColumn('message_id', 'uuid', c => c.notNull().references('chat_messages.id'))
      .addPrimaryKeyConstraint('chat_delivery_sequence', ['stream_id', 'sequence'])
      .addUniqueConstraint('chat_delivery_message', ['stream_id', 'message_id']).execute();
    await db.schema.createTable('chat_operations')
      .addColumn('sender_id', 'uuid', c => c.notNull())
      .addColumn('operation_id', 'uuid', c => c.notNull())
      .addColumn('signature', 'text', c => c.notNull()).addColumn('result', 'jsonb')
      .addPrimaryKeyConstraint('chat_operation_sender', ['sender_id', 'operation_id']).execute();
    await db.schema.createTable('battles').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('data', 'jsonb', c => c.notNull())
      .addColumn('version', 'integer', c => c.notNull().defaultTo(0)).execute();
    await sql`CREATE INDEX battles_turn_deadline ON battles (((data->>'turnDeadlineAt')::bigint)) WHERE data->>'status' = 'active'`.execute(db);
    await db.schema.createTable('battle_rewards')
      .addColumn('battle_id', 'uuid', c => c.notNull().references('battles.id'))
      .addColumn('character_id', 'uuid', c => c.notNull().references('characters.id'))
      .addColumn('experience', 'integer', c => c.notNull())
      .addPrimaryKeyConstraint('battle_rewards_pk', ['battle_id', 'character_id']).execute();
    await db.schema.createTable('battle_archive_outbox')
      .addColumn('id', 'uuid', c => c.primaryKey().references('battles.id'))
      .addColumn('data', 'jsonb', c => c.notNull())
      .addColumn('delivered_at', 'timestamptz').execute();
    await db.schema.createIndex('battle_archive_outbox_pending')
      .on('battle_archive_outbox').column('id').where(sql<boolean>`delivered_at is null`).execute();
    await db.schema.createTable('inventories')
      .addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('owner_id', 'uuid', c => c.notNull().references('characters.id'))
      .addColumn('name', 'varchar(48)', c => c.notNull())
      .addColumn('capacity', 'integer', c => c.notNull())
      .addColumn('is_primary', 'boolean', c => c.notNull().defaultTo(false))
      .addUniqueConstraint('inventories_id_owner', ['id', 'owner_id'])
      .addCheckConstraint('inventories_capacity_positive', sql`capacity > 0`).execute();
    await sql`CREATE UNIQUE INDEX inventories_primary_owner ON inventories(owner_id) WHERE is_primary`.execute(db);
    await db.schema.createTable('item_instances')
      .addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('owner_id', 'uuid', c => c.notNull().references('characters.id'))
      .addColumn('inventory_id', 'uuid')
      .addColumn('item_id', 'varchar(64)', c => c.notNull())
      .addColumn('quantity', 'integer', c => c.notNull())
      .addColumn('equipped_slot', 'varchar(64)')
      .addColumn('quality', 'jsonb')
      .addColumn('effects', 'jsonb')
      .addColumn('item_level', 'integer', c => c.notNull().defaultTo(1))
      .addColumn('definition_version', 'integer', c => c.notNull().defaultTo(1))
      .addForeignKeyConstraint('item_inventory_owner', ['inventory_id', 'owner_id'], 'inventories', ['id', 'owner_id'])
      .addCheckConstraint('item_effects_array', sql`effects is null or jsonb_typeof(effects) = 'array'`)
      .addCheckConstraint('item_quantity_positive', sql`quantity > 0`)
      .addCheckConstraint('item_quality_equipment_check', sql`quality is null or (quantity = 1 and jsonb_typeof(quality) = 'object')`)
      .addCheckConstraint('item_level_bounds', sql`item_level between 1 and 1000`)
      .addCheckConstraint('item_definition_version_positive', sql`definition_version > 0`).execute();
    await db.schema.createIndex('item_instances_owner').on('item_instances').column('owner_id').execute();
    await sql`CREATE UNIQUE INDEX equipped_slot_owner ON item_instances(owner_id, equipped_slot) WHERE equipped_slot IS NOT NULL`.execute(db);
    for (const table of ['inventory_operations', 'crafting_operations']) {
      await db.schema.createTable(table).addColumn('id', 'uuid', c => c.primaryKey())
        .addColumn('signature', 'text', c => c.notNull()).addColumn('result', 'jsonb').execute();
    }
    for (const [index, character] of characters.entries()) {
      const accountId = demoAccounts[Math.floor(index / 5)].id;
      await db.insertInto('characters').values({ id: character.id, account_id: accountId, data: JSON.stringify({ ...character, accountId }) }).execute();
      await db.insertInto('inventories').values({ id: character.id, owner_id: character.id, name: 'Рюкзак', capacity: 50, is_primary: true }).execute();
      for (const stack of character.inventory) {
        const definition = seedContent.items.find(item => item.id === stack.itemId)!;
        for (let remaining = stack.quantity; remaining > 0; remaining -= definition.stackLimit) {
          await db.insertInto('item_instances').values({ id: randomUUID(), owner_id: character.id, inventory_id: character.id,
            item_id: stack.itemId, effects: consumableEffects(definition).length ? JSON.stringify(consumableEffects(definition)) : null, quantity: Math.min(remaining, definition.stackLimit), item_level: definition.itemLevel ?? 1, definition_version: definition.version ?? 1 }).execute();
        }
      }
    }
  },
};
