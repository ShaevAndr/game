import { Inject, Injectable } from '@nestjs/common';
import type { WorldDeliveryResult } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { WorldJournalRepository, type WorldJournalEntry, type WorldRegistration } from '../ports/world-journal.repository';

@Injectable()
export class PostgresWorldJournalRepository extends WorldJournalRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  private registrationView(row: { world_id: string; party_id: string; state: string; sequence: string | number }): WorldRegistration {
    return { id: row.world_id, partyId: row.party_id, state: row.state as WorldRegistration['state'], sequence: Number(row.sequence) };
  }
  async registration(worldId: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('world_journal_worlds').selectAll().where('world_id', '=', worldId).forUpdate().executeTakeFirst();
    return row ? this.registrationView(row) : null;
  }
  async active(partyId: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('world_journal_worlds').selectAll().where('party_id', '=', partyId).where('state', '!=', 'closed').forUpdate().executeTakeFirst();
    return row ? this.registrationView(row) : null;
  }
  async create(worldId: string, partyId: string, context: TransactionContext) {
    return !!await this.db.session(context).insertInto('world_journal_worlds').values({ world_id: worldId, party_id: partyId, state: 'active', sequence: 0 })
      .onConflict(conflict => conflict.doNothing()).returning('world_id').executeTakeFirst();
  }
  async append(entry: WorldJournalEntry, context: TransactionContext, state?: WorldRegistration['state']) {
    const tx = this.db.session(context), { delivery } = entry;
    await tx.insertInto('world_journal_entries').values({ id: delivery.id, world_id: delivery.worldId, sequence: delivery.sequence,
      player_id: entry.playerId, operation_id: entry.operationId, signature: entry.signature, data: JSON.stringify(delivery), result: null }).execute();
    await tx.updateTable('world_journal_worlds').set({ sequence: delivery.sequence, ...(state ? { state } : {}) }).where('world_id', '=', delivery.worldId).execute();
  }
  async operation(worldId: string, playerId: string, operationId: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('world_journal_entries').selectAll().where('world_id', '=', worldId)
      .where('player_id', '=', playerId).where('operation_id', '=', operationId).executeTakeFirst();
    return row ? { delivery: row.data, playerId: row.player_id, operationId: row.operation_id, signature: row.signature, result: row.result } : null;
  }
  async pending(worldId?: string, afterWorldId?: string) {
    let query = this.db.sql.selectFrom('world_journal_entries').selectAll().where('result', 'is', null);
    if (worldId) query = query.where('world_id', '=', worldId);
    else {
      query = query.distinctOn('world_id');
      if (afterWorldId) query = query.where('world_id', '>', afterWorldId);
    }
    return (await query.orderBy('world_id').orderBy('sequence').limit(64).execute()).map(row => ({ delivery: row.data,
      playerId: row.player_id, operationId: row.operation_id, signature: row.signature, result: row.result }));
  }
  async finish(entry: WorldJournalEntry, result: WorldDeliveryResult, context: TransactionContext, state?: WorldRegistration['state']) {
    const tx = this.db.session(context);
    const completed = await tx.updateTable('world_journal_entries').set({ result: JSON.stringify(result), last_error: null }).where('id', '=', entry.delivery.id)
      .where('result', 'is', null).returning('id').executeTakeFirst();
    if (!completed) return;
    if (state) await tx.updateTable('world_journal_worlds').set({ state }).where('world_id', '=', entry.delivery.worldId).where('state', '!=', 'closed').execute();
  }
  async failure(id: string, message: string) {
    await this.db.sql.updateTable('world_journal_entries').set({ last_error: message.slice(0, 1000) }).where('id', '=', id).where('result', 'is', null).execute();
  }
}
