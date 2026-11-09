import type { CargoOffer, CargoImportProof, CargoImportResult } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
export interface CargoRecord { offer: CargoOffer; result: CargoImportResult | null }
export interface CargoAcknowledgement { id: string; proof: CargoImportProof }
export abstract class WorldCargoRepository {
  abstract register(offer: CargoOffer, context: TransactionContext): Promise<CargoRecord>;
  abstract get(manifestId: string, context: TransactionContext): Promise<CargoRecord | null>;
  abstract list(playerId: string, characterId: string): Promise<CargoRecord[]>;
  abstract result(manifestId: string, result: CargoImportResult, context: TransactionContext): Promise<void>;
  abstract acknowledge(proof: CargoImportProof, context: TransactionContext): Promise<void>;
  abstract pending(): Promise<CargoAcknowledgement[]>;
  abstract sent(id: string): Promise<void>;
  abstract failure(id: string, error: string, permanent: boolean): Promise<void>;
  abstract claim(playerId: string, operationId: string, signature: string, context: TransactionContext): Promise<{ signature: string; result: CargoImportProof | null }>;
  abstract finishClaim(playerId: string, operationId: string, result: CargoImportProof, context: TransactionContext): Promise<void>;
}
