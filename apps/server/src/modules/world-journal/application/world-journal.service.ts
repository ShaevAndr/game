import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Party, WorldDelivery, WorldDeliveryResult } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { WorldJournalRepository, type WorldJournalEntry, type WorldRegistration } from '../ports/world-journal.repository';
export type { WorldJournalEntry } from '../ports/world-journal.repository';

export const worldPartySnapshot = (party: Party) => ({ id: party.id, revision: party.revision, leaderPlayerId: party.leaderPlayerId,
  members: party.members.map(({ playerId, characterId, membershipId }) => ({ playerId, characterId, membershipId })) });
@Injectable()
export class WorldJournalService {
  constructor(@Inject(WorldJournalRepository) private readonly repository: WorldJournalRepository) {}
  registration(worldId: string, context: TransactionContext) { return this.repository.registration(worldId, context); }
  active(partyId: string, context: TransactionContext) { return this.repository.active(partyId, context); }
  create(worldId: string, partyId: string, context: TransactionContext) { return this.repository.create(worldId, partyId, context); }
  operation(worldId: string, playerId: string, operationId: string, context: TransactionContext) { return this.repository.operation(worldId, playerId, operationId, context); }
  pending(worldId?: string, afterWorldId?: string) { return this.repository.pending(worldId, afterWorldId); }
  failure(id: string, message: string) { return this.repository.failure(id, message); }
  async complete(entry: WorldJournalEntry, result: WorldDeliveryResult, context: TransactionContext) {
    // The caller holds this registration lock while releasing any inventory reservation.
    await this.repository.registration(entry.delivery.worldId, context);
    const payload = entry.delivery.payload, success = result.status < 400;
    let state: WorldRegistration['state'] | undefined;
    if (payload.kind === 'start' && !success || payload.kind === 'party' && payload.party === null && success
      || payload.kind === 'action' && payload.request.command.action.type === 'close' && success) state = 'closed';
    else if (payload.kind === 'action' && payload.request.command.action.type === 'close' && !success) state = 'active';
    await this.repository.finish(entry, result, context, state);
  }
  async append(worldId: string, payload: WorldDelivery['payload'], playerId: string | null, operationId: string | null,
    signature: string, context: TransactionContext, id = randomUUID()): Promise<WorldJournalEntry> {
    const registration = await this.repository.registration(worldId, context);
    if (!registration || registration.state === 'closed') throw new ConflictException('Экспедиция закрыта');
    if (registration.sequence >= Number.MAX_SAFE_INTEGER) throw new ConflictException('Исчерпан счётчик команд экспедиции');
    const entry: WorldJournalEntry = { delivery: { id, worldId, sequence: registration.sequence + 1, payload }, playerId, operationId, signature, result: null };
    const closing = payload.kind === 'party' && payload.party === null || payload.kind === 'action' && payload.request.command.action.type === 'close';
    await this.repository.append(entry, context, closing ? 'closing' : undefined); return entry;
  }
  /** Called inside the party mutation transaction, after acquiring the party lock. */
  async partyChanged(partyId: string, party: Party | null, context: TransactionContext) {
    const registration = await this.repository.active(partyId, context);
    if (!registration) return;
    await this.append(registration.id, { kind: 'party', party: party ? worldPartySnapshot(party) : null }, null, null, '', context);
  }
}
