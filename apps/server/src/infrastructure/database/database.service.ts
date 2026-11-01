import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Kysely, Migrator, PostgresDialect, Transaction } from 'kysely';
import { Pool } from 'pg';
import { TransactionContext, UnitOfWork } from '../../shared/application/unit-of-work';
import { Tables } from './tables';
import { initialMigration } from './migrations/init';

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
      init: initialMigration,
    }) } });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
  }

  async onApplicationShutdown() { await this.sql.destroy(); }
}
