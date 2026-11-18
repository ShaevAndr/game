import type { ArenaState } from '@game/core';
import type { ActionRunner } from '../../shared/model/useAsyncAction';
import { arenaApi } from './api/arena.api';
import { ArenaScreen } from './components/ArenaScreen';
import type { useArenaActions } from './model/useArenaActions';
import { useRooms } from './model/useRooms';

interface Props {
  characterId: string;
  hasCharacter: boolean;
  arena: ArenaState | null;
  actions: ReturnType<typeof useArenaActions>;
  busy: boolean;
  run: ActionRunner;
  onError: (message: string) => void;
  onRoom: (id: string) => void;
  refreshArena: () => Promise<void>;
}

export function ArenaPage({ characterId, hasCharacter, arena, actions, busy, run, onError, onRoom, refreshArena }: Props) {
  const { rooms, loading, refreshRooms } = useRooms(true, onError);
  const cancel = (id: string) => void run(async () => {
    await arenaApi.cancel(id, characterId);
    await Promise.all([refreshRooms(), refreshArena()]);
  }, refreshRooms);
  const create: Parameters<typeof ArenaScreen>[0]['onCreate'] = async input => {
    let created = false;
    await run(async () => {
      const room = await arenaApi.create({ ...input, characterId });
      created = true;
      if (room.kind === 'duel') await Promise.all([refreshRooms(), refreshArena()]);
      else onRoom(room.id);
    }, refreshRooms);
    return created;
  };

  return <ArenaScreen
    characterId={characterId} arena={arena} rooms={rooms} loading={loading}
    canCreate={hasCharacter && !!arena && !arena.activeBattleId} busy={busy}
    onAccept={actions.accept} onChallenge={actions.challenge} onDismiss={actions.dismiss}
    onOpen={onRoom} onCancel={cancel} onCreate={create}
    onRefresh={() => void run(refreshRooms, refreshRooms)}
  />;
}
