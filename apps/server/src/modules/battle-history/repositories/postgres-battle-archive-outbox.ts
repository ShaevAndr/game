import { Inject, Injectable } from '@nestjs/common';
import { Battle } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { BattleArchiveOutbox } from '../ports/battle-history.repository';

@Injectable()
export class PostgresBattleArchiveOutbox extends BattleArchiveOutbox {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async stage(battle: Battle, context: TransactionContext) {
    await this.db.session(context).insertInto('battle_archive_outbox')
      .values({ id: battle.id, data: JSON.stringify(battle) }).onConflict(c => c.column('id').doNothing()).execute();
  }
  async pending(limit: number) {
    return (await this.db.sql.selectFrom('battle_archive_outbox').select('data')
      .where('delivered_at', 'is', null).orderBy('id').limit(limit).execute()).map(row => row.data);
  }
  async delivered(id: string) {
    await this.db.sql.updateTable('battle_archive_outbox').set({ delivered_at: new Date() }).where('id', '=', id).execute();
  }
}
