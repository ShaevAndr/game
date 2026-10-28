import { Migration } from 'kysely';

export const initialMigration: Migration = {
  async up(db) {
    await db.schema.createTable('characters').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('data', 'jsonb', c => c.notNull()).execute();
    await db.schema.createTable('battles').addColumn('id', 'uuid', c => c.primaryKey())
      .addColumn('data', 'jsonb', c => c.notNull())
      .addColumn('version', 'integer', c => c.notNull().defaultTo(0)).execute();
  },
};
