import { Migration, sql } from 'kysely';

export const battleArchiveOutboxMigration: Migration = {
  async up(db) {
    await db.schema.createTable('battle_archive_outbox')
      .addColumn('id', 'uuid', c => c.primaryKey().references('battles.id'))
      .addColumn('data', 'jsonb', c => c.notNull())
      .addColumn('delivered_at', 'timestamptz').execute();
    await db.schema.createIndex('battle_archive_outbox_pending')
      .on('battle_archive_outbox').column('id').where(sql<boolean>`delivered_at is null`).execute();
    // Include completed battles from installations upgraded from the previous structure.
    await sql`INSERT INTO battle_archive_outbox (id, data)
      SELECT id, data FROM battles WHERE data->>'status' = 'finished'`.execute(db);
  },
};
