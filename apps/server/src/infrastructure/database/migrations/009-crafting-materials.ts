import { Migration, sql } from 'kysely';

/** One-time local playtest supplies; a full backpack is left untouched. */
export const craftingMaterialsMigration: Migration = {
  async up(db) {
    await sql`INSERT INTO item_instances (id, owner_id, inventory_id, item_id, quantity)
      SELECT gen_random_uuid(), i.owner_id, i.id, materials.item_id, materials.quantity
      FROM inventories i
      CROSS JOIN (VALUES ('iron-ore', 60), ('leather', 40), ('healing-herb', 40)) AS materials(item_id, quantity)
      WHERE i.is_primary AND (SELECT count(*) FROM item_instances existing
        WHERE existing.inventory_id = i.id AND existing.equipped_slot IS NULL) + 3 <= i.capacity`.execute(db);
  },
};
