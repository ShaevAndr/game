import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ColumnType, Kysely, Migrator, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Battle, Character } from '@game/core';
import { demoCharactersMigration } from './migrations/003-demo-characters';

export interface Tables {
  characters: { id: string; data: ColumnType<Character, string, string> };
  battles: { id: string; data: ColumnType<Battle, string, string>; version: number };
  battle_rewards: { battle_id: string; character_id: string; experience: number };
}
@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  readonly sql = new Kysely<Tables>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.POSTGRES_URL ?? 'postgres://game:game@localhost:5432/game' }) }) });
  async onModuleInit() {
    const migration = new Migrator({ db: this.sql, provider: { getMigrations: async () => ({ '001_initial': { up: async (db: Kysely<unknown>) => {
      await db.schema.createTable('characters').addColumn('id', 'uuid', c => c.primaryKey()).addColumn('data', 'jsonb', c => c.notNull()).execute();
      await db.schema.createTable('battles').addColumn('id', 'uuid', c => c.primaryKey()).addColumn('data', 'jsonb', c => c.notNull()).addColumn('version', 'integer', c => c.notNull().defaultTo(0)).execute();
    } }, '002_progression_rewards': { up: async (db: Kysely<unknown>) => {
      await db.schema.createTable('battle_rewards')
        .addColumn('battle_id', 'uuid', c => c.notNull().references('battles.id'))
        .addColumn('character_id', 'uuid', c => c.notNull().references('characters.id'))
        .addColumn('experience', 'integer', c => c.notNull())
        .addPrimaryKeyConstraint('battle_rewards_pk', ['battle_id', 'character_id']).execute();
    } }, '003_demo_characters': demoCharactersMigration }) } });
    const result = await migration.migrateToLatest(); if (result.error) throw result.error;
  }
  async onModuleDestroy() { await this.sql.destroy(); }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
