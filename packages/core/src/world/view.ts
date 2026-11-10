import { worldVoxel } from './movement';
import type { GatheringLoot } from '../gathering/types';
import type { VoxelPosition, VoxelWorld, WorldActor, WorldCell, WorldRegion } from './types';
import { insideRegion, voxelIndex, voxelNeighbors, worldBlockAt, worldBlockHealth } from './voxels';
import type { WorldMember } from './protocol';

export interface WorldExpeditionView extends WorldView {
  partyRevision: number; ownerFence: number; leaderPlayerId: string; members: WorldMember[];
}
export interface CurrentWorldExpedition { worldId: string | null; state: 'active' | 'closing' | null }

export interface WorldView {
  id: string; revision: number; status: VoxelWorld['status']; map: WorldCell[];
  biomes: { id: string; name: string }[];
  location: VoxelWorld['location']; cargo: GatheringLoot[]; xp: number; cargoCapacity: number;
  region: null | {
    cellId: string; revision: number; size: VoxelPosition; blockSizeMeters: number;
    blocks: { position: VoxelPosition; blockId: string; hp?: number; maxHp?: number }[];
    palette: { id: string; name: string; color: string; allowedToolClassIds: string[] }[];
  };
}

/** Only surfaces adjacent to air connected to the party are visible. Sealed ore and
 * cavities, generation seeds, loot tables and internal chunk palettes stay private.
 */
export function visibleWorldBlocks(region: WorldRegion, origin: VoxelPosition): { position: VoxelPosition; blockId: string }[] {
  if (!insideRegion(region, origin) || worldBlockAt(region, origin) !== null) throw new Error('Недопустимая точка обзора');
  const seen = new Uint8Array(region.size.x * region.size.y * region.size.z);
  const queue: VoxelPosition[] = [{ ...origin }];
  const result: { position: VoxelPosition; blockId: string }[] = [];
  seen[voxelIndex(origin, region.size)] = 1;
  for (let i = 0; i < queue.length; i++) for (const p of voxelNeighbors(queue[i])) {
    if (!insideRegion(region, p)) continue;
    const index = voxelIndex(p, region.size);
    if (seen[index]) continue;
    seen[index] = 1;
    const blockId = worldBlockAt(region, p);
    if (blockId === null) queue.push(p); else result.push({ position: p, blockId });
  }
  return result;
}

/** Actor must already be authorized by the application for this current party. */
export function worldView(state: VoxelWorld, actor: WorldActor): WorldView {
  if (actor.partyId !== state.partyId || !actor.playerId || !actor.characterId || !actor.membershipId) throw new Error('Нет доступа к миру группы');
  const gatherer = state.gatherers.find(entry => entry.characterId === actor.characterId);
  if (gatherer && gatherer.playerId !== actor.playerId) throw new Error('Владелец груза не совпадает');
  const snapshot = state.location?.position ? state.regions.find(entry => entry.cellId === state.location!.cellId) : undefined;
  const blocks = snapshot ? visibleWorldBlocks(snapshot, worldVoxel(state.location!.position!)).map(block => {
    const definition = state.catalog.blocks.find(entry => entry.id === block.blockId)!;
    return definition.harvest ? { ...block, ...worldBlockHealth(snapshot, block.position, definition) } : block;
  }) : [];
  const visibleIds = new Set(blocks.map(block => block.blockId));
  const location = structuredClone(state.location); if (location?.motion) delete location.motion.simulatedAt;
  return {
    id: state.id, revision: state.revision, status: state.status, map: structuredClone(state.map),
    biomes: state.catalog.biomes.map(({ id, name }) => ({ id, name })),
    location, cargo: structuredClone(gatherer?.cargo ?? []),
    xp: gatherer?.xp ?? 0, cargoCapacity: state.settings.cargoCapacity,
    region: snapshot ? { cellId: snapshot.cellId, revision: snapshot.revision, size: { ...snapshot.size },
      blockSizeMeters: state.settings.blockSizeMeters, blocks,
      palette: state.catalog.blocks.filter(block => visibleIds.has(block.id)).map(block => ({
        id: block.id, name: block.name, color: block.color, allowedToolClassIds: [...(block.harvest?.allowedToolClassIds ?? [])],
      })),
    } : null,
  };
}
