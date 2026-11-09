import type { WorldDelivery, WorldDeliveryResult } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
export interface WorldRegistration { id: string; partyId: string; state: 'active' | 'closing' | 'closed'; sequence: number }
export interface WorldJournalEntry { delivery: WorldDelivery; playerId: string | null; operationId: string | null; signature: string; result: WorldDeliveryResult | null }
export abstract class WorldJournalRepository {
  abstract registration(worldId: string, context: TransactionContext): Promise<WorldRegistration | null>;
  abstract active(partyId: string, context: TransactionContext): Promise<WorldRegistration | null>;
  abstract create(worldId: string, partyId: string, context: TransactionContext): Promise<boolean>;
  abstract append(entry: WorldJournalEntry, context: TransactionContext, state?: WorldRegistration['state']): Promise<void>;
  abstract operation(worldId: string, playerId: string, operationId: string, context: TransactionContext): Promise<WorldJournalEntry | null>;
  abstract pending(worldId?: string, afterWorldId?: string): Promise<WorldJournalEntry[]>;
  abstract finish(entry: WorldJournalEntry, result: WorldDeliveryResult, context: TransactionContext, state?: WorldRegistration['state']): Promise<void>;
  abstract failure(id: string, message: string): Promise<void>;
}
