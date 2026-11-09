import type { GatheringLoot, WorldCargoManifest, WorldRegion, WorldDeliveryResult, CargoOffer, CargoImportResult } from '@game/core';
import type { ColumnType } from 'kysely';
import type { WorldCommandResult, WorldDefinition, WorldGeometry } from '../../shared/application/world-contracts';

export interface WorldTables {
  cargo_outbox: { manifest_id: string; data: ColumnType<CargoOffer, string, never>; result: ColumnType<CargoImportResult | null, string | null, string>;
    delivered_at: ColumnType<Date | null, Date | null | undefined, Date>; failed: ColumnType<boolean, boolean | undefined, boolean>;
    retry_at: ColumnType<Date, Date | undefined, Date>; last_error: ColumnType<string | null, string | null | undefined, string | null> };
  instances: { id: string; party_id: string; owner_player_id: string; owner_character_id: string; party_revision: number; owner_fence: number; revision: number; status: 'active' | 'closed'; data: ColumnType<WorldDefinition, string, string> };
  geometry: { world_id: string; data: ColumnType<WorldGeometry, string, string> };
  regions: { world_id: string; cell_id: string; revision: number; data: ColumnType<WorldRegion, string, string> };
  members: { world_id: string; character_id: string; player_id: string; membership_id: string; active: boolean; cargo: ColumnType<GatheringLoot[], string, string> };
  progress: { character_id: string; player_id: string; xp: number };
  operations: { world_id: string; player_id: string; operation_id: string; signature: string; result: ColumnType<WorldCommandResult, string, never>; rolls: ColumnType<number[], string, never> };
  manifests: { id: string; world_id: string; player_id: string; character_id: string; hash: string; data: ColumnType<WorldCargoManifest, string, never> };
  deliveries: { id: string; world_id: string; sequence: number; signature: string; result: ColumnType<WorldDeliveryResult, string, never> };
}
