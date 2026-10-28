import { Inject, Injectable } from '@nestjs/common';
import { Battle } from '@game/core';
import { sql } from 'kysely';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { BattlesRepository } from '../ports/battles.repository';

@Injectable()
export class PostgresBattlesRepository extends BattlesRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async list() {
    return (await this.db.sql.selectFrom('battles').select('data')
      .orderBy(sql`data->>'createdAt'`, 'desc').limit(100).execute()).map(row => row.data);
  }
  async find(id: string) {
    return (await this.db.sql.selectFrom('battles').select('data').where('id', '=', id).executeTakeFirst())?.data;
  }
  async create(battle: Battle) {
    await this.db.sql.insertInto('battles').values({ id: battle.id, version: battle.version, data: JSON.stringify(battle) }).execute();
  }
  async lock(id: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('battles').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    return row ? { battle: row.data, version: row.version } : undefined;
  }
  async save(battle: Battle, context: TransactionContext) {
    await this.db.session(context).updateTable('battles').set({ data: JSON.stringify(battle), version: battle.version })
      .where('id', '=', battle.id).execute();
  }
}
