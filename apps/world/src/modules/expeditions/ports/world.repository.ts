import type { VoxelWorld, WorldCargoManifest, WorldDeliveryResult } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import type { WorldCommandResult, WorldMember } from '../../../shared/application/world-contracts';

export interface WorldRecord {
  state: VoxelWorld; members: WorldMember[]; ownerPlayerId: string; ownerCharacterId: string; partyRevision: number; ownerFence: number;
}
export abstract class WorldRepository {
  abstract lockParty(partyId: string, context: TransactionContext): Promise<void>;
  abstract activeWorld(partyId: string, context: TransactionContext): Promise<string | null>;
  abstract load(worldId: string, context: TransactionContext, additionalMembers?: WorldMember[]): Promise<WorldRecord | null>;
  abstract progress(members: WorldMember[], context: TransactionContext): Promise<{ playerId: string; characterId: string; xp: number }[]>;
  abstract create(record: WorldRecord, context: TransactionContext): Promise<boolean>;
  abstract save(state: VoxelWorld, expectedRevision: number, context: TransactionContext): Promise<boolean>;
  abstract receipt(worldId: string, playerId: string, operationId: string, context: TransactionContext): Promise<{ signature: string; result: WorldCommandResult } | null>;
  abstract finish(worldId: string, playerId: string, signature: string, result: WorldCommandResult, rolls: number[], context: TransactionContext): Promise<void>;
  abstract seal(manifests: WorldCargoManifest[], context: TransactionContext): Promise<void>;
  abstract manifests(worldId: string, playerId: string, characterId: string, context: TransactionContext): Promise<WorldCargoManifest[]>;
  abstract ready(context: TransactionContext): Promise<void>;
  abstract roster(record: WorldRecord, context: TransactionContext): Promise<void>;
  abstract lockDeliveries(worldId: string, context: TransactionContext): Promise<void>;
  abstract lastDelivery(worldId: string, context: TransactionContext): Promise<number>;
  abstract delivery(worldId: string, sequence: number, context: TransactionContext): Promise<{ id: string; signature: string; result: WorldDeliveryResult } | null>;
  abstract finishDelivery(worldId: string, sequence: number, id: string, signature: string, result: WorldDeliveryResult, context: TransactionContext): Promise<void>;
}
