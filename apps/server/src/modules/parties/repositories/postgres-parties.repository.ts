import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Party, PartyCommandResult, PartyInvitation } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { PartiesRepository } from '../ports/parties.repository';

@Injectable()
export class PostgresPartiesRepository extends PartiesRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async lock(context: TransactionContext) { await sql`select pg_advisory_xact_lock(714001, 1)`.execute(this.db.session(context)); }
  async partyOf(playerId: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('party_members').innerJoin('parties', 'parties.id', 'party_members.party_id')
      .select('parties.data').where('party_members.player_id', '=', playerId).executeTakeFirst();
    return row?.data ?? null;
  }
  async party(id: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('parties').select('data').where('id', '=', id).executeTakeFirst())?.data ?? null;
  }
  async save(party: Party, context: TransactionContext) {
    const tx = this.db.session(context), data = JSON.stringify(party);
    await tx.insertInto('parties').values({ id: party.id, data }).onConflict(conflict => conflict.column('id').doUpdateSet({ data })).execute();
    await tx.deleteFrom('party_members').where('party_id', '=', party.id).execute();
    await tx.insertInto('party_members').values(party.members.map(member => ({ player_id: member.playerId, party_id: party.id, character_id: member.characterId }))).execute();
  }
  async remove(id: string, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.deleteFrom('party_members').where('party_id', '=', id).execute();
    await tx.deleteFrom('parties').where('id', '=', id).execute();
  }
  async invitation(id: string, context?: TransactionContext) {
    return (await this.db.session(context).selectFrom('party_invitations').select('data').where('id', '=', id).executeTakeFirst())?.data ?? null;
  }
  async invitationsFor(playerId: string, now: number, context?: TransactionContext) {
    return (await this.db.session(context).selectFrom('party_invitations').select('data').where('status', '=', 'pending').where('expires_at', '>', now)
      .where(eb => eb.or([eb('inviter_id', '=', playerId), eb('target_id', '=', playerId)])).orderBy('id').execute()).map(row => row.data)
      .sort((one, two) => one.createdAt - two.createdAt || one.id.localeCompare(two.id));
  }
  async invitationsInParty(partyId: string, now: number, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('party_invitations').select('data').where('party_id', '=', partyId).where('status', '=', 'pending').where('expires_at', '>', now).execute()).map(row => row.data);
  }
  async recentlyDeclined(inviterId: string, targetId: string, since: number, context: TransactionContext) {
    return !!await this.db.session(context).selectFrom('party_invitations').select('id').where('inviter_id', '=', inviterId).where('target_id', '=', targetId)
      .where('status', '=', 'declined').where('resolved_at', '>', since).executeTakeFirst();
  }
  async saveInvitation(invitation: PartyInvitation, context: TransactionContext) {
    const values = { id: invitation.id, party_id: invitation.partyId, inviter_id: invitation.inviterPlayerId, target_id: invitation.targetPlayerId,
      status: invitation.status, expires_at: invitation.expiresAt, resolved_at: invitation.resolvedAt, data: JSON.stringify(invitation) };
    await this.db.session(context).insertInto('party_invitations').values(values).onConflict(conflict => conflict.column('id').doUpdateSet(values)).execute();
  }
  async cancelInvitations(filter: { partyId?: string; targetPlayerId?: string }, now: number, context: TransactionContext, exceptId?: string) {
    if (!filter.partyId && !filter.targetPlayerId) throw new Error('Invitation cancellation requires a scope');
    let query = this.db.session(context).selectFrom('party_invitations').select('data').where('status', '=', 'pending');
    if (filter.partyId) query = query.where('party_id', '=', filter.partyId);
    if (filter.targetPlayerId) query = query.where('target_id', '=', filter.targetPlayerId);
    if (exceptId) query = query.where('id', '!=', exceptId);
    for (const row of await query.execute()) await this.saveInvitation({ ...row.data, status: 'cancelled', resolvedAt: now }, context);
  }
  async claim(playerId: string, operationId: string, signature: string, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.insertInto('party_operations').values({ player_id: playerId, operation_id: operationId, signature, result: null })
      .onConflict(conflict => conflict.columns(['player_id', 'operation_id']).doNothing()).execute();
    return tx.selectFrom('party_operations').select(['signature', 'result']).where('player_id', '=', playerId).where('operation_id', '=', operationId).forUpdate().executeTakeFirstOrThrow();
  }
  async complete(playerId: string, operationId: string, result: PartyCommandResult, context: TransactionContext) {
    await this.db.session(context).updateTable('party_operations').set({ result: JSON.stringify(result) }).where('player_id', '=', playerId).where('operation_id', '=', operationId).execute();
  }
}
