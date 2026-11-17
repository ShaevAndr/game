import { Inject, Injectable } from '@nestjs/common';
import { ArenaChallenge, ArenaState, Battle } from '@game/core';
import { sql } from 'kysely';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { BattlesRepository } from '../ports/battles.repository';

@Injectable()
export class PostgresBattlesRepository extends BattlesRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async list(onlineCharacterIds: string[]) {
    if (!onlineCharacterIds.length) return [];
    return (await this.db.sql.selectFrom('battles').select('data')
      .where(sql<boolean>`data->>'status' = 'waiting'`)
      .where(sql<string>`data->'fighters'->0->>'characterId'`, 'in', onlineCharacterIds)
      .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM battles AS active
        WHERE active.data->>'status' = 'active' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(active.data->'fighters') AS fighter
          WHERE fighter->>'characterId' = battles.data->'fighters'->0->>'characterId'
            AND COALESCE((fighter->>'surrendered')::boolean, false) = false))`)
      .orderBy(sql`data->>'createdAt'`, 'desc').limit(100).execute()).map(row => row.data);
  }
  // A single short transaction lock orders offer changes and all battle starts across processes.
  async lockMatchmaking(context: TransactionContext) {
    await sql`SELECT pg_advisory_xact_lock(71824, 1)`.execute(this.db.session(context));
  }
  async arenaState(characterId: string, context: TransactionContext): Promise<ArenaState> {
    const offers = await this.db.session(context).selectFrom('arena_challenges').select('data')
      .where('status', '=', 'pending').where(eb => eb.or([
        eb('challenger_id', '=', characterId), eb('recipient_id', '=', characterId),
      ])).orderBy('id').execute();
    const active = await this.db.session(context).selectFrom('battles').select('id')
      .where(sql<boolean>`data->>'status' = 'active' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(data->'fighters') AS fighter
        WHERE fighter->>'characterId' = ${characterId} AND COALESCE((fighter->>'surrendered')::boolean, false) = false)`)
      .executeTakeFirst();
    return { incoming: offers.map(row => row.data).filter(offer => offer.recipientId === characterId),
      outgoing: offers.map(row => row.data).filter(offer => offer.challengerId === characterId), activeBattleId: active?.id ?? null };
  }
  async challenge(id: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('arena_challenges').select('data').where('id', '=', id).executeTakeFirst())?.data;
  }
  async pendingChallenge(battleId: string, challengerId: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('arena_challenges').select('data')
      .where('battle_id', '=', battleId).where('challenger_id', '=', challengerId).where('status', '=', 'pending').executeTakeFirst())?.data;
  }
  async saveChallenge(offer: ArenaChallenge, context: TransactionContext) {
    await this.db.session(context).insertInto('arena_challenges').values({ id: offer.id, battle_id: offer.battleId,
      challenger_id: offer.challengerId, recipient_id: offer.recipientId, status: offer.status, data: JSON.stringify(offer) })
      .onConflict(oc => oc.column('id').doUpdateSet({ status: offer.status, data: JSON.stringify(offer) })).execute();
  }
  async cancelChallenges(characterIds: string[], context: TransactionContext) {
    await this.db.session(context).updateTable('arena_challenges')
      .set({ status: 'cancelled', data: sql`jsonb_set(data, '{status}', '"cancelled"'::jsonb)` })
      .where('status', '=', 'pending').where(eb => eb.or([
        eb('challenger_id', 'in', characterIds), eb('recipient_id', 'in', characterIds),
      ])).execute();
  }
  async find(id: string) {
    return (await this.db.sql.selectFrom('battles').select('data').where('id', '=', id).executeTakeFirst())?.data;
  }
  async hasActiveCharacter(characterId: string, context?: TransactionContext) {
    const match = JSON.stringify({ status: 'active', fighters: [{ characterId }] });
    const row = await this.db.session(context).selectFrom('battles').select('id')
      .where(sql<boolean>`data @> ${match}::jsonb`)
      .where(sql<boolean>`EXISTS (SELECT 1 FROM jsonb_array_elements(data->'fighters') AS fighter
        WHERE fighter->>'characterId' = ${characterId} AND COALESCE((fighter->>'surrendered')::boolean, false) = false)`)
      .limit(1).executeTakeFirst();
    return !!row;
  }
  async create(battle: Battle) {
    await this.db.sql.insertInto('battles').values({ id: battle.id, version: battle.version, data: JSON.stringify(battle) }).execute();
  }
  async removeRoom(id: string, context: TransactionContext) {
    const transaction = this.db.session(context);
    await transaction.deleteFrom('arena_challenges').where('battle_id', '=', id).execute();
    await transaction.deleteFrom('battles').where('id', '=', id).execute();
  }
  async expired(now: number, limit: number) {
    return (await this.db.sql.selectFrom('battles').select('id')
      .where(sql<boolean>`data->>'status' = 'active' AND (data->>'turnDeadlineAt')::bigint <= ${now}`)
      .orderBy(sql`(data->>'turnDeadlineAt')::bigint`).limit(limit).execute()).map(row => row.id);
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
