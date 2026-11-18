import type { ArenaChallenge } from '@game/core';
import type { ActionRunner } from '../../../shared/model/useAsyncAction';
import { arenaApi } from '../api/arena.api';

interface Options {
  characterId: string;
  run: ActionRunner;
  refreshArena: () => Promise<void>;
  onRoom: (id: string) => void;
}

export function useArenaActions({ characterId, run, refreshArena, onRoom }: Options) {
  const accept = (offer: ArenaChallenge) => void run(async () => {
    const started = await arenaApi.accept(offer, characterId);
    onRoom(started.id);
    await refreshArena();
  });
  const challenge = (roomId: string) => void run(async () => {
    await arenaApi.challenge(roomId, characterId);
    await refreshArena();
  });
  const dismiss = (offer: ArenaChallenge) => void run(async () => {
    await arenaApi.dismiss(offer, characterId);
    await refreshArena();
  });
  return { accept, challenge, dismiss };
}
