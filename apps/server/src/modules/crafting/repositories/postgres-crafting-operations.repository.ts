import { Inject, Injectable } from '@nestjs/common';
import { CraftingResult } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { CraftingOperationsRepository } from '../ports/crafting-operations.repository';

@Injectable()
export class PostgresCraftingOperationsRepository extends CraftingOperationsRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }

  async claimOperation(id: string, signature: string, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.insertInto('crafting_operations').values({ id, signature, result: null }).onConflict(conflict => conflict.column('id').doNothing()).execute();
    return tx.selectFrom('crafting_operations').select(['signature', 'result']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
  }

  async finishOperation(id: string, result: CraftingResult, context: TransactionContext) {
    await this.db.session(context).updateTable('crafting_operations').set({ result: JSON.stringify(result) }).where('id', '=', id).execute();
  }
}
