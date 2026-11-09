import type { CargoOffer, CargoImportProof, CargoImportResult } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
export abstract class WorldCargoRepository {
  abstract pending(): Promise<CargoOffer[]>;
  abstract lock(manifestId: string, context: TransactionContext): Promise<{ offer: CargoOffer; result: CargoImportResult | null } | null>;
  abstract result(manifestId: string, result: CargoImportResult, context: TransactionContext): Promise<void>;
  abstract sent(manifestId: string, context: TransactionContext): Promise<void>;
  abstract failure(manifestId: string, message: string, permanent: boolean): Promise<void>;
}
