import { Inject, Injectable } from '@nestjs/common';
import type { GatheringReceipt, GatheringState } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { GatheringRepository } from '../ports/gathering.repository';

@Injectable()
export class PostgresGatheringRepository extends GatheringRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async load(ownerId: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('gathering_states').select('data').where('character_id', '=', ownerId).executeTakeFirst())?.data ?? null;
  }
  async save(ownerId: string, state: GatheringState, context: TransactionContext) {
    const data = JSON.stringify(state);
    await this.db.session(context).insertInto('gathering_states').values({ character_id: ownerId, data })
      .onConflict(conflict => conflict.column('character_id').doUpdateSet({ data })).execute();
  }
  async claim(ownerId: string, operationId: string, signature: string, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.insertInto('gathering_operations').values({ character_id: ownerId, operation_id: operationId, signature, result: null })
      .onConflict(conflict => conflict.columns(['character_id', 'operation_id']).doNothing()).execute();
    return tx.selectFrom('gathering_operations').select(['signature', 'result']).where('character_id', '=', ownerId).where('operation_id', '=', operationId).forUpdate().executeTakeFirstOrThrow();
  }
  async finish(ownerId: string, operationId: string, result: GatheringReceipt, context: TransactionContext) {
    await this.db.session(context).updateTable('gathering_operations').set({ result: JSON.stringify(result) })
      .where('character_id', '=', ownerId).where('operation_id', '=', operationId).execute();
  }
}
