import { Migration, sql } from 'kysely';

export const craftingMigration: Migration = {
  async up(db) {
    await db.schema.createTable('crafting_operations')
      .addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('signature', 'text', c => c.notNull())
      .addColumn('result', 'jsonb').execute();
    // Test bundle of materials for every existing player so the crafting screen can be tried immediately.
    await sql`INSERT INTO item_instances (id, owner_id, inventory_id, item_id, quantity)
      SELECT gen_random_uuid(), c.id, i.id, materials.item_id, materials.quantity
      FROM characters c
      JOIN inventories i ON i.owner_id = c.id AND i.is_primary
      CROSS JOIN (VALUES ('iron-ore', 20), ('healing-herb', 15), ('leather', 10)) AS materials(item_id, quantity)`.execute(db);
  },
};
