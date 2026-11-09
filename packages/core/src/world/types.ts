import type { GatheringLoot, ResourceType } from '../gathering/types';

export interface VoxelPosition { x: number; y: number; z: number }
export interface WorldSettings {
  mapWidth: number; mapDepth: number;
  regionSize: VoxelPosition; chunkSize: VoxelPosition;
  blockSizeMeters: number; minGroundHeight: number; maxGroundHeight: number;
  treeChanceBps: number; cargoCapacity: number;
}
export interface WorldDrop extends GatheringLoot { chanceBps: number }
export interface WorldBlockDefinition {
  id: string; name: string; color: string;
  harvest?: {
    resourceId: string; resourceType: ResourceType; level: number;
    allowedToolClassIds: string[]; drops: WorldDrop[];
  };
}
export interface WorldBiome {
  id: string; name: string; weight: number;
  surfaceBlockId: string; soilBlockId: string; stoneBlockId: string;
  trees: { trunkBlockId: string; crownBlockId: string; height: number }[];
  veins: { blockId: string; minDepth: number; maxDepth: number; chanceBps: number }[];
}
export interface WorldCatalog {
  toolClasses: { id: string; name: string }[];
  foundationBlockId: string; blocks: WorldBlockDefinition[]; biomes: WorldBiome[];
}
export interface WorldCell { id: string; x: number; z: number; biomeId: string }
export interface VoxelChunk {
  position: VoxelPosition; size: VoxelPosition;
  /** Palette index 0 is air. Never send this internal palette to the browser. */
  palette: (string | null)[]; blocks: number[];
}
export interface WorldRegion {
  cellId: string; seed: number; revision: number;
  size: VoxelPosition; chunkSize: VoxelPosition; spawn: VoxelPosition; chunks: VoxelChunk[];
}
/** Prepared by the application after checking current membership. Never a client claim. */
export interface WorldActor {
  playerId: string; characterId: string; partyId: string; membershipId: string; isLeader: boolean;
}
/** The application must verify/reserve this concrete inventory instance for the command. */
export interface WorldTool {
  instanceId: string; ownerCharacterId: string; toolClassId: string;
}
export interface WorldGatherer {
  playerId: string; characterId: string; xp: number; cargo: GatheringLoot[];
}
/** Internal aggregate; storage, membership authorization and command receipts are application concerns. */
export interface VoxelWorld {
  id: string; partyId: string; generatorRevision: 1; seed: number; rngState: number;
  revision: number; status: 'active' | 'closed'; catalog: WorldCatalog; settings: WorldSettings;
  map: WorldCell[]; regions: WorldRegion[];
  location: { cellId: string; position: VoxelPosition | null } | null;
  gatherers: WorldGatherer[];
}
export interface WorldCargoManifest {
  id: string; worldId: string; playerId: string; characterId: string; cargo: GatheringLoot[];
}
/** Internal result for the application's atomic commit; rolls must not go to the browser. */
export interface WorldOutcome {
  type: 'travel' | 'enter' | 'leave' | 'move' | 'harvest' | 'close';
  success: boolean; loot: GatheringLoot[]; xpGained: number; rolls: number[];
  manifests: WorldCargoManifest[];
}
