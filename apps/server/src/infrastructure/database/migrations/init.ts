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
    await db.schema.createTable('inventory_world_reservations').addColumn('instance_id', 'uuid', c => c.primaryKey().references('item_instances.id'))
      .addColumn('owner_id', 'uuid', c => c.notNull().references('characters.id')).addColumn('operation_id', 'uuid', c => c.notNull().unique())
      .addColumn('world_id', 'uuid', c => c.notNull()).execute();
    for (const table of ['inventory_operations', 'crafting_operations']) {
      await db.schema.createTable(table).addColumn('id', 'uuid', c => c.primaryKey())
        .addColumn('signature', 'text', c => c.notNull()).addColumn('result', 'jsonb').execute();
    }
    await db.schema.createTable('parties').addColumn('id', 'uuid', c => c.primaryKey()).addColumn('data', 'jsonb', c => c.notNull()).execute();
    await db.schema.createTable('party_members').addColumn('player_id', 'uuid', c => c.primaryKey())
      .addColumn('party_id', 'uuid', c => c.notNull().references('parties.id'))
      .addColumn('character_id', 'uuid', c => c.notNull().references('characters.id')).execute();
    await db.schema.createIndex('party_members_party').on('party_members').column('party_id').execute();
    await db.schema.createTable('party_invitations').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('party_id', 'uuid', c => c.notNull()).addColumn('inviter_id', 'uuid', c => c.notNull()).addColumn('target_id', 'uuid', c => c.notNull())
      .addColumn('status', 'varchar(16)', c => c.notNull()).addColumn('expires_at', 'bigint', c => c.notNull()).addColumn('resolved_at', 'bigint')
      .addColumn('data', 'jsonb', c => c.notNull()).addCheckConstraint('party_invitation_status', sql`status in ('pending', 'accepted', 'declined', 'cancelled')`).execute();
    await db.schema.createIndex('party_invitation_target').on('party_invitations').columns(['target_id', 'status', 'expires_at']).execute();
    await db.schema.createIndex('party_invitation_party').on('party_invitations').columns(['party_id', 'status']).execute();
    await db.schema.createIndex('party_invitation_inviter').on('party_invitations').columns(['inviter_id', 'target_id', 'status', 'resolved_at']).execute();
    await db.schema.createTable('party_operations').addColumn('player_id', 'uuid', c => c.notNull())
      .addColumn('operation_id', 'uuid', c => c.notNull()).addColumn('signature', 'text', c => c.notNull()).addColumn('result', 'jsonb')
      .addPrimaryKeyConstraint('party_operation_player', ['player_id', 'operation_id']).execute();
    await db.schema.createTable('gathering_states')
      .addColumn('character_id', 'uuid', c => c.primaryKey().references('characters.id'))
      .addColumn('data', 'jsonb', c => c.notNull()).execute();
    await db.schema.createTable('gathering_operations')
      .addColumn('character_id', 'uuid', c => c.notNull().references('characters.id'))
      .addColumn('operation_id', 'uuid', c => c.notNull()).addColumn('signature', 'text', c => c.notNull())
      .addColumn('result', 'jsonb').addPrimaryKeyConstraint('gathering_operation_character', ['character_id', 'operation_id']).execute();
    await db.schema.createTable('world_journal_worlds').addColumn('world_id', 'uuid', c => c.primaryKey())
      .addColumn('party_id', 'uuid', c => c.notNull()).addColumn('state', 'varchar(16)', c => c.notNull())
      .addColumn('sequence', 'bigint', c => c.notNull()).addCheckConstraint('world_journal_state', sql`state in ('active', 'closing', 'closed')`)
      .addCheckConstraint('world_journal_sequence', sql`sequence between 0 and 9007199254740991`).execute();
    await sql`CREATE UNIQUE INDEX world_journal_active_party ON world_journal_worlds(party_id) WHERE state != 'closed'`.execute(db);
    await db.schema.createTable('world_journal_entries').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('world_id', 'uuid', c => c.notNull().references('world_journal_worlds.world_id')).addColumn('sequence', 'bigint', c => c.notNull())
      .addColumn('player_id', 'uuid').addColumn('operation_id', 'uuid').addColumn('signature', 'text', c => c.notNull())
      .addColumn('data', 'jsonb', c => c.notNull()).addColumn('result', 'jsonb').addColumn('last_error', 'text')
      .addUniqueConstraint('world_journal_order', ['world_id', 'sequence'])
      .addUniqueConstraint('world_journal_operation', ['world_id', 'player_id', 'operation_id']).execute();
    await sql`CREATE INDEX world_journal_pending ON world_journal_entries(world_id, sequence) WHERE result IS NULL`.execute(db);
    await db.schema.createTable('world_cargo_imports').addColumn('manifest_id', 'varchar(112)', c => c.primaryKey())
      .addColumn('world_id', 'uuid', c => c.notNull()).addColumn('player_id', 'uuid', c => c.notNull()).addColumn('character_id', 'uuid', c => c.notNull())
      .addColumn('data', 'jsonb', c => c.notNull()).addColumn('result', 'jsonb').execute();
    await db.schema.createIndex('world_cargo_owner').on('world_cargo_imports').columns(['player_id', 'character_id']).execute();
    await db.schema.createTable('world_cargo_operations').addColumn('player_id', 'uuid', c => c.notNull()).addColumn('operation_id', 'uuid', c => c.notNull())
      .addColumn('signature', 'varchar(64)', c => c.notNull()).addColumn('result', 'jsonb').addPrimaryKeyConstraint('world_cargo_operation', ['player_id', 'operation_id']).execute();
    await db.schema.createTable('world_cargo_ack_outbox').addColumn('manifest_id', 'varchar(112)', c => c.primaryKey().references('world_cargo_imports.manifest_id'))
      .addColumn('data', 'jsonb', c => c.notNull()).addColumn('delivered_at', 'timestamptz').addColumn('failed', 'boolean', c => c.notNull().defaultTo(false))
      .addColumn('retry_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`)).addColumn('last_error', 'text').execute();
    await sql`CREATE INDEX world_cargo_ack_pending ON world_cargo_ack_outbox(retry_at) WHERE delivered_at IS NULL AND NOT failed`.execute(db);
    // The world process owns only this schema. No cross-domain table/FK access is required.
    await db.schema.createSchema('world').execute();
    const world = db.withSchema('world');
    await world.schema.createTable('instances').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('party_id', 'uuid', c => c.notNull()).addColumn('owner_player_id', 'uuid', c => c.notNull())
      .addColumn('owner_character_id', 'uuid', c => c.notNull()).addColumn('revision', 'bigint', c => c.notNull())
      .addColumn('party_revision', 'bigint', c => c.notNull().defaultTo(0)).addColumn('owner_fence', 'bigint', c => c.notNull().defaultTo(0))
      .addColumn('status', 'varchar(16)', c => c.notNull()).addColumn('data', 'jsonb', c => c.notNull())
      .addCheckConstraint('world_revision_bounds', sql`revision between 0 and 9007199254740991`)
      .addCheckConstraint('world_party_revision_bounds', sql`party_revision between 0 and 9007199254740991`)
      .addCheckConstraint('world_owner_fence_bounds', sql`owner_fence between 0 and 9007199254740991`)
      .addCheckConstraint('world_status', sql`status in ('active', 'closed')`)
      .addCheckConstraint('world_definition_object', sql`jsonb_typeof(data) = 'object'`).execute();
    await sql`CREATE UNIQUE INDEX world_active_party ON world.instances(party_id) WHERE status = 'active'`.execute(db);
    await world.schema.createTable('geometry').addColumn('world_id', 'uuid', c => c.primaryKey().references('world.instances.id'))
      .addColumn('data', 'jsonb', c => c.notNull()).addCheckConstraint('world_geometry_object', sql`jsonb_typeof(data) = 'object'`).execute();
    await world.schema.createTable('regions').addColumn('world_id', 'uuid', c => c.notNull().references('world.instances.id'))
      .addColumn('cell_id', 'varchar(8)', c => c.notNull()).addColumn('revision', 'bigint', c => c.notNull())
      .addColumn('data', 'jsonb', c => c.notNull()).addPrimaryKeyConstraint('world_region_cell', ['world_id', 'cell_id'])
      .addCheckConstraint('world_region_revision', sql`revision between 0 and 9007199254740991`)
      .addCheckConstraint('world_region_object', sql`jsonb_typeof(data) = 'object'`).execute();
    await world.schema.createTable('progress').addColumn('character_id', 'uuid', c => c.primaryKey())
      .addColumn('player_id', 'uuid', c => c.notNull()).addColumn('xp', 'bigint', c => c.notNull())
      .addUniqueConstraint('world_progress_owner', ['character_id', 'player_id'])
      .addCheckConstraint('world_xp_bounds', sql`xp between 0 and 9007199254740991`).execute();
    await world.schema.createTable('members').addColumn('world_id', 'uuid', c => c.notNull().references('world.instances.id'))
      .addColumn('character_id', 'uuid', c => c.notNull()).addColumn('player_id', 'uuid', c => c.notNull())
      .addColumn('membership_id', 'uuid', c => c.notNull()).addColumn('cargo', 'jsonb', c => c.notNull())
      .addColumn('active', 'boolean', c => c.notNull().defaultTo(true))
      .addPrimaryKeyConstraint('world_member_character', ['world_id', 'character_id'])
      .addForeignKeyConstraint('world_member_progress', ['character_id', 'player_id'], 'world.progress', ['character_id', 'player_id'])
      .addCheckConstraint('world_cargo_array', sql`jsonb_typeof(cargo) = 'array'`).execute();
    await sql`CREATE UNIQUE INDEX world_member_active_player ON world.members(world_id, player_id) WHERE active`.execute(db);
    await sql`CREATE UNIQUE INDEX world_member_active_membership ON world.members(world_id, membership_id) WHERE active`.execute(db);
    await world.schema.createTable('operations').addColumn('world_id', 'uuid', c => c.notNull().references('world.instances.id'))
      .addColumn('player_id', 'uuid', c => c.notNull()).addColumn('operation_id', 'uuid', c => c.notNull())
      .addColumn('signature', 'varchar(64)', c => c.notNull()).addColumn('result', 'jsonb', c => c.notNull())
      .addColumn('rolls', 'jsonb', c => c.notNull()).addPrimaryKeyConstraint('world_operation_player', ['world_id', 'player_id', 'operation_id'])
      .addCheckConstraint('world_result_object', sql`jsonb_typeof(result) = 'object'`)
      .addCheckConstraint('world_rolls_array', sql`jsonb_typeof(rolls) = 'array'`).execute();
    await world.schema.createTable('manifests').addColumn('id', 'varchar(112)', c => c.primaryKey())
      .addColumn('world_id', 'uuid', c => c.notNull().references('world.instances.id')).addColumn('player_id', 'uuid', c => c.notNull())
      .addColumn('character_id', 'uuid', c => c.notNull()).addColumn('hash', 'varchar(64)', c => c.notNull())
      .addColumn('data', 'jsonb', c => c.notNull())
      .addCheckConstraint('world_manifest_object', sql`jsonb_typeof(data) = 'object'`).execute();
    await world.schema.createTable('cargo_outbox').addColumn('manifest_id', 'varchar(112)', c => c.primaryKey().references('world.manifests.id'))
      .addColumn('data', 'jsonb', c => c.notNull()).addColumn('result', 'jsonb').addColumn('delivered_at', 'timestamptz')
      .addColumn('failed', 'boolean', c => c.notNull().defaultTo(false)).addColumn('retry_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
      .addColumn('last_error', 'text').execute();
    await sql`CREATE INDEX world_cargo_pending ON world.cargo_outbox(retry_at) WHERE delivered_at IS NULL AND NOT failed`.execute(db);
    await world.schema.createTable('deliveries').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('world_id', 'uuid', c => c.notNull()).addColumn('sequence', 'bigint', c => c.notNull())
      .addColumn('signature', 'varchar(64)', c => c.notNull()).addColumn('result', 'jsonb', c => c.notNull())
      .addUniqueConstraint('world_delivery_order', ['world_id', 'sequence'])
      .addCheckConstraint('world_delivery_sequence', sql`sequence between 1 and 9007199254740991`).execute();
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
