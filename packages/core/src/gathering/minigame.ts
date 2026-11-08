import type { ResourceType } from './types';

export interface GatheringMinigameContext {
  resourceId: string;
  resourceType: ResourceType;
  resourceLevel: number;
  methodId: string;
}

/** Server entry point for dispatching the resource/level-specific minigame.
 * Placeholder: every valid attempt currently permits obtaining the material.
 * Interactive games will require a server-verified challenge before settlement.
 */
export function runGatheringMinigame(_context: GatheringMinigameContext): boolean {
  return true;
}
