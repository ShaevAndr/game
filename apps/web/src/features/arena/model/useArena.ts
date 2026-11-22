import { useLiveRefresh } from '../../../shared/model/useLiveRefresh';
import { useCallback, useRef, useState } from 'react';
import { ArenaState } from '@game/core';
import { arenaApi } from '../api/arena.api';

/** Offers are reconciled on every screen, independently of the open battle socket. */
export function useArena(characterId: string, onError: (message: string) => void) {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const sequence = useRef(0);
  const refreshArena = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current;
    const next = await arenaApi.state(characterId, signal);
    if (!signal?.aborted && sequence.current === request) setArena(next);
  }, [characterId]);
  useLiveRefresh('arena', !!characterId, refreshArena, error => onError(error.message), characterId);
  return { arena, refreshArena };
}
