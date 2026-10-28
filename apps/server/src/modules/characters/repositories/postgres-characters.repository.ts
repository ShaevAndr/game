import { Inject, Injectable } from '@nestjs/common';
import { Character } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { CharactersRepository } from '../ports/characters.repository';

@Injectable()
export class PostgresCharactersRepository extends CharactersRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async list() { return (await this.db.sql.selectFrom('characters').select('data').execute()).map(row => row.data); }
  async find(id: string, context?: TransactionContext, lock = false) {
    let query = this.db.session(context).selectFrom('characters').select('data').where('id', '=', id);
    if (lock) {
      if (!context) throw new Error('A row lock requires a transaction');
      query = query.forUpdate();
    }
    return (await query.executeTakeFirst())?.data;
  }
  async create(character: Character) {
    await this.db.sql.insertInto('characters').values({ id: character.id, data: JSON.stringify(character) }).execute();
  }
  async save(character: Character, context: TransactionContext) {
    await this.db.session(context).updateTable('characters').set({ data: JSON.stringify(character) }).where('id', '=', character.id).execute();
  }
}
