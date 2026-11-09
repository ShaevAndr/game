import type { WorldDelivery, WorldDeliveryResult, WorldIdentity } from '@game/core';
export abstract class WorldRemote {
  abstract enabled(): boolean;
  abstract deliver(delivery: WorldDelivery): Promise<WorldDeliveryResult>;
  abstract read(worldId: string, identity: WorldIdentity): Promise<unknown>;
  abstract manifests(worldId: string, playerId: string, characterId: string): Promise<unknown>;
}
