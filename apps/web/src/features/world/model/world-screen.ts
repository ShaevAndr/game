import type { Content, Party } from '@game/core';
import type { useWorld } from './useWorld';

export interface WorldScreenProps {
  world: ReturnType<typeof useWorld>; playerId: string; characterId: string; party: Party | null; partyReady: boolean; partyBusy: boolean; inventoryOpen: boolean;
  content: Content | null; onInventory: () => void; onCrafting: () => void; onGathering: () => void;
}
