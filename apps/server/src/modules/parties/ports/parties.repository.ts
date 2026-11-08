import type { Party, PartyCommandResult, PartyInvitation } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class PartiesRepository {
  abstract lock(context: TransactionContext): Promise<void>;
  abstract partyOf(playerId: string, context: TransactionContext): Promise<Party | null>;
  abstract party(id: string, context: TransactionContext): Promise<Party | null>;
  abstract save(party: Party, context: TransactionContext): Promise<void>;
  abstract remove(id: string, context: TransactionContext): Promise<void>;
  abstract invitation(id: string, context?: TransactionContext): Promise<PartyInvitation | null>;
  abstract invitationsFor(playerId: string, now: number, context?: TransactionContext): Promise<PartyInvitation[]>;
  abstract invitationsInParty(partyId: string, now: number, context: TransactionContext): Promise<PartyInvitation[]>;
  abstract recentlyDeclined(inviterId: string, targetId: string, since: number, context: TransactionContext): Promise<boolean>;
  abstract saveInvitation(invitation: PartyInvitation, context: TransactionContext): Promise<void>;
  abstract cancelInvitations(filter: { partyId?: string; targetPlayerId?: string }, now: number, context: TransactionContext, exceptId?: string): Promise<void>;
  abstract claim(playerId: string, operationId: string, signature: string, context: TransactionContext): Promise<{ signature: string; result: PartyCommandResult | null }>;
  abstract complete(playerId: string, operationId: string, result: PartyCommandResult, context: TransactionContext): Promise<void>;
}
