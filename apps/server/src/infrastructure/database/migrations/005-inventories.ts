import { Migration, sql } from 'kysely';

export const inventoriesMigration: Migration = {
  async up(db) {
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
      .addForeignKeyConstraint('item_inventory_owner', ['inventory_id', 'owner_id'], 'inventories', ['id', 'owner_id'])
      .addCheckConstraint('item_quantity_positive', sql`quantity > 0`).execute();
    await db.schema.createIndex('item_instances_owner').on('item_instances').column('owner_id').execute();
    await sql`CREATE UNIQUE INDEX equipped_slot_owner ON item_instances(owner_id, equipped_slot) WHERE equipped_slot IS NOT NULL`.execute(db);
    await db.schema.createTable('inventory_operations')
      .addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('signature', 'text', c => c.notNull())
      .addColumn('result', 'jsonb').execute();
    await sql`INSERT INTO inventories(id, owner_id, name, capacity, is_primary)
      SELECT id, id, 'Рюкзак', GREATEST(50, COALESCE((SELECT SUM(CEIL((stack->>'quantity')::numeric / 99))
        FROM jsonb_array_elements(COALESCE(data->'inventory', '[]'::jsonb)) stack), 0))::int, true FROM characters`.execute(db);
    await sql`INSERT INTO item_instances(id, owner_id, inventory_id, item_id, quantity)
      SELECT gen_random_uuid(), c.id, c.id, stack->>'itemId', LEAST(99, (stack->>'quantity')::int - offset_value)
      FROM characters c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.data->'inventory', '[]'::jsonb)) stack
      CROSS JOIN LATERAL generate_series(0, (stack->>'quantity')::int - 1, 99) offset_value`.execute(db);
  },
};
