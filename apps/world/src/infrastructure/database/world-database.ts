import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool, types } from 'pg';
import { UnitOfWork, type TransactionContext } from '../../shared/application/unit-of-work';
import type { WorldTables } from './tables';

@Injectable()
export class WorldDatabase extends UnitOfWork implements OnModuleInit, OnApplicationShutdown {
  readonly sql = new Kysely<WorldTables>({ dialect: new PostgresDialect({ pool: new Pool({
    connectionString: process.env.WORLD_POSTGRES_URL ?? 'postgres://game:game@localhost:5432/game',
    connectionTimeoutMillis: 5000, statement_timeout: 15000,
    types: { getTypeParser: (oid, format) => oid === 20 ? (value: string) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('World integer exceeds the safe range');
      return number;
    } : types.getTypeParser(oid, format) },
  }) }) }).withSchema('world');
  private readonly sessions = new WeakMap<TransactionContext, Transaction<WorldTables>>();

  session(context: TransactionContext): Kysely<WorldTables> {
    const transaction = this.sessions.get(context);
    if (!transaction) throw new Error('Transaction is no longer active');
    return transaction;
  }
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.sql.transaction().execute(async transaction => {
      const context = { id: Symbol('world-transaction') };
      this.sessions.set(context, transaction);
      try { return await work(context); } finally { this.sessions.delete(context); }
    });
  }
  async onModuleInit() {
    try {
      // Only the main server's single init migration owns DDL. This process never migrates.
      for (const table of ['instances', 'geometry', 'regions', 'members', 'progress', 'operations', 'manifests', 'deliveries', 'cargo_outbox'] as const)
        await this.sql.selectFrom(table).selectAll().limit(0).execute();
    } catch (error) {
      await this.sql.destroy();
      throw new Error('World schema is unavailable: initialize a fresh database with the main server init migration and grant access to schema world', { cause: error });
    }
  }
  async onApplicationShutdown() { await this.sql.destroy(); }
}
