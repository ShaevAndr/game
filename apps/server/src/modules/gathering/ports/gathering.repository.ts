import type { GatheringReceipt, GatheringState } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class GatheringRepository {
  abstract load(ownerId: string, context: TransactionContext): Promise<GatheringState | null>;
  abstract save(ownerId: string, state: GatheringState, context: TransactionContext): Promise<void>;
  abstract claim(ownerId: string, operationId: string, signature: string, context: TransactionContext): Promise<{ signature: string; result: GatheringReceipt | null }>;
  abstract finish(ownerId: string, operationId: string, result: GatheringReceipt, context: TransactionContext): Promise<void>;
}
