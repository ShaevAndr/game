import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CargoImportResult } from '@game/core';
import { WorldDatabase } from '../../../infrastructure/database/world-database';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { WorldCargoRepository } from '../ports/world-cargo.repository';
@Injectable()
export class PostgresWorldCargoRepository extends WorldCargoRepository {
  constructor(@Inject(WorldDatabase) private readonly db: WorldDatabase) { super(); }
  async pending() {
    return (await this.db.sql.selectFrom('cargo_outbox').select('data').where('delivered_at', 'is', null).where('failed', '=', false)
      .where('retry_at', '<=', new Date()).orderBy('retry_at').limit(16).execute()).map(row => row.data);
  }
  async lock(manifestId: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('cargo_outbox').select(['data', 'result']).where('manifest_id', '=', manifestId).forUpdate().executeTakeFirst();
    return row ? { offer: row.data, result: row.result } : null;
  }
  async result(manifestId: string, result: CargoImportResult, context: TransactionContext) {
    await this.db.session(context).updateTable('cargo_outbox').set({ result: JSON.stringify(result) }).where('manifest_id', '=', manifestId).execute();
  }
  async sent(manifestId: string, context: TransactionContext) {
    await this.db.session(context).updateTable('cargo_outbox').set({ delivered_at: new Date(), last_error: null }).where('manifest_id', '=', manifestId).execute();
  }
  async failure(manifestId: string, message: string, permanent: boolean) {
    await this.db.sql.updateTable('cargo_outbox').set({ last_error: message.slice(0, 1000), failed: permanent, retry_at: sql`now() + interval '10 seconds'` })
      .where('manifest_id', '=', manifestId).where('delivered_at', 'is', null).execute();
  }
}
