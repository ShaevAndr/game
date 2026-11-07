import { Inject, Injectable } from '@nestjs/common';
import { Character } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { CharactersRepository } from '../ports/characters.repository';

@Injectable()
export class PostgresCharactersRepository extends CharactersRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async list(accountId?: string) {
    let query = this.db.sql.selectFrom('characters').select(['data', 'account_id']);
    if (accountId) query = query.where('account_id', '=', accountId);
    return (await query.execute()).map(row => ({ ...row.data, accountId: row.account_id }));
  }
  async find(id: string, context?: TransactionContext, lock = false) {
    let query = this.db.session(context).selectFrom('characters').select(['data', 'account_id']).where('id', '=', id);
    if (lock) {
      if (!context) throw new Error('A row lock requires a transaction');
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    return row && { ...row.data, ...(row.account_id ? { accountId: row.account_id } : {}) };
  }
  async create(character: Character, context: TransactionContext) {
    if (!character.accountId) throw new Error('Character requires an account owner');
    await this.db.session(context).insertInto('characters').values({ id: character.id, account_id: character.accountId, data: JSON.stringify(character) }).execute();
  }
  async save(character: Character, context: TransactionContext) {
    await this.db.session(context).updateTable('characters').set({ data: JSON.stringify(character) }).where('id', '=', character.id).execute();
  }
}
