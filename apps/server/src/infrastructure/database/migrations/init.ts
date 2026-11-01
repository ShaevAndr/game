import { randomUUID } from 'node:crypto';
import { Migration, sql } from 'kysely';
import { seedContent } from '@game/core';
import characters from '../seeds/demo-characters.json';

/** Pre-release v1 baseline. Schema changes belong here until a new release is explicitly started. */
export const initialMigration: Migration = {
  async up(db) {
    await db.schema.createTable('characters').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('data', 'jsonb', c => c.notNull()).execute();
    await db.schema.createTable('battles').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('data', 'jsonb', c => c.notNull())
      .addColumn('version', 'integer', c => c.notNull().defaultTo(0)).execute();
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
      .addColumn('item_level', 'integer', c => c.notNull().defaultTo(1))
      .addColumn('definition_version', 'integer', c => c.notNull().defaultTo(1))
      .addForeignKeyConstraint('item_inventory_owner', ['inventory_id', 'owner_id'], 'inventories', ['id', 'owner_id'])
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
    for (const character of characters) {
      await db.insertInto('characters').values({ id: character.id, data: JSON.stringify(character) }).execute();
      await db.insertInto('inventories').values({ id: character.id, owner_id: character.id, name: 'Рюкзак', capacity: 50, is_primary: true }).execute();
      for (const stack of character.inventory) {
        const definition = seedContent.items.find(item => item.id === stack.itemId)!;
        for (let remaining = stack.quantity; remaining > 0; remaining -= definition.stackLimit) {
          await db.insertInto('item_instances').values({ id: randomUUID(), owner_id: character.id, inventory_id: character.id,
            item_id: stack.itemId, quantity: Math.min(remaining, definition.stackLimit), item_level: definition.itemLevel ?? 1, definition_version: definition.version ?? 1 }).execute();
        }
      }
    }
  },
};
