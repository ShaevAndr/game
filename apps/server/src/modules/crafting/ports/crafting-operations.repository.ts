import { CraftingResult } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class CraftingOperationsRepository {
  abstract claimOperation(id: string, signature: string, context: TransactionContext): Promise<{ signature: string; result: CraftingResult | null }>;
  abstract finishOperation(id: string, result: CraftingResult, context: TransactionContext): Promise<void>;
}
