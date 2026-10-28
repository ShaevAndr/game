import { InventoryResult, InventoryState, ItemInstance, ItemStack } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class InventoryRepository {
  abstract ensurePrimary(ownerId: string, initial: ItemStack[], limits: Record<string, number>, context: TransactionContext): Promise<void>;
  abstract load(ownerId: string, context: TransactionContext): Promise<InventoryState>;
  abstract instance(id: string, context?: TransactionContext): Promise<ItemInstance | undefined>;
  abstract inventoryOwner(id: string, context?: TransactionContext): Promise<string | undefined>;
  abstract save(states: InventoryState[], context: TransactionContext): Promise<void>;
  abstract claimOperation(id: string, signature: string, context: TransactionContext): Promise<{ signature: string; result: InventoryResult | null }>;
  abstract finishOperation(id: string, result: InventoryResult, context: TransactionContext): Promise<void>;
}
