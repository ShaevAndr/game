import { Migration } from 'kysely';

export const progressionRewardsMigration: Migration = {
  async up(db) {
    await db.schema.createTable('battle_rewards')
      .addColumn('battle_id', 'uuid', c => c.notNull().references('battles.id'))
      .addColumn('character_id', 'uuid', c => c.notNull().references('characters.id'))
      .addColumn('experience', 'integer', c => c.notNull())
      .addPrimaryKeyConstraint('battle_rewards_pk', ['battle_id', 'character_id']).execute();
  },
};
