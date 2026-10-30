import { craftingMaterialsMigration } from './migrations/009-crafting-materials';
import { itemQualityMigration } from './migrations/008-item-quality';
import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Kysely, Migrator, PostgresDialect, Transaction } from 'kysely';
import { Pool } from 'pg';
import { TransactionContext, UnitOfWork } from '../../shared/application/unit-of-work';
import { Tables } from './tables';
import { matchedCombatMigration } from './migrations/006-matched-combat';
import { initialMigration } from './migrations/001-initial';
import { progressionRewardsMigration } from './migrations/002-progression-rewards';
import { demoCharactersMigration } from './migrations/003-demo-characters';
import { inventoriesMigration } from './migrations/005-inventories';
import { battleArchiveOutboxMigration } from './migrations/004-battle-archive-outbox';
import { craftingMigration } from './migrations/007-crafting';

@Injectable()
export class Database extends UnitOfWork implements OnModuleInit, OnApplicationShutdown {
  readonly sql = new Kysely<Tables>({ dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.POSTGRES_URL ?? 'postgres://game:game@localhost:5432/game' }),
  }) });
  private readonly sessions = new WeakMap<TransactionContext, Transaction<Tables>>();

  session(context?: TransactionContext): Kysely<Tables> {
    if (!context) return this.sql;
    const session = this.sessions.get(context);
    if (!session) throw new Error('Transaction is no longer active');
    return session;
  }

  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.sql.transaction().execute(async transaction => {
      const context: TransactionContext = { id: Symbol('transaction') };
      this.sessions.set(context, transaction);
      try { return await work(context); } finally { this.sessions.delete(context); }
    });
  }

  async onModuleInit() {
    const migrator = new Migrator({ db: this.sql, provider: { getMigrations: async () => ({
      '001_initial': initialMigration,
      '002_progression_rewards': progressionRewardsMigration,
      '003_demo_characters': demoCharactersMigration,
      '004_battle_archive_outbox': battleArchiveOutboxMigration,
      '005_inventories': inventoriesMigration,
      '006_matched_combat': matchedCombatMigration,
      '007_crafting': craftingMigration,
      '008_item_quality': itemQualityMigration,
      '009_crafting_materials': craftingMaterialsMigration,
    }) } });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
  }

  async onApplicationShutdown() { await this.sql.destroy(); }
}
