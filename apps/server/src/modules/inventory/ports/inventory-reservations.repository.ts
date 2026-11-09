import type { TransactionContext } from '../../../shared/application/unit-of-work';
export interface InventoryWorldReservation { instanceId: string; ownerId: string; operationId: string; worldId: string }
export abstract class InventoryReservationsRepository {
  abstract forOwner(ownerId: string, context: TransactionContext): Promise<InventoryWorldReservation[]>;
  abstract reserve(reservation: InventoryWorldReservation, context: TransactionContext): Promise<boolean>;
  abstract release(operationId: string, ownerId: string, context: TransactionContext): Promise<void>;
}
