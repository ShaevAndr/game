import { Kysely, sql } from 'kysely';

export const itemQualityMigration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable('item_instances').addColumn('quality', 'jsonb').execute();
    await sql`alter table item_instances add constraint item_quality_equipment_check check (quality is null or (quantity = 1 and jsonb_typeof(quality) = 'object'))`.execute(db);
  },
  async down(db: Kysely<any>) { await db.schema.alterTable('item_instances').dropColumn('quality').execute(); },
};
