import { useCallback, useEffect, useRef, useState } from 'react';
import { ArenaState } from '@game/core';
import { arenaApi } from '../api/arena.api';

/** Offers are reconciled on every screen, independently of the open battle socket. */
export function useArena(characterId: string, onError: (message: string) => void) {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const sequence = useRef(0);
  const refreshArena = useCallback(async () => {
    const request = ++sequence.current;
    const next = await arenaApi.state(characterId);
    if (sequence.current === request) setArena(next);
  }, [characterId]);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try { await refreshArena(); }
      catch (error) { if (!cancelled) onError((error as Error).message); }
      finally { pending = false; }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 3000);
    return () => { cancelled = true; ++sequence.current; clearInterval(timer); };
  }, [refreshArena, onError]);
  return { arena, refreshArena };
}
