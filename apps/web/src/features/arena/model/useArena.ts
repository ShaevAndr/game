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
    let reloadRequested = false;
    const load = async (resume = false) => {
      if (cancelled) return;
      if (pending) { reloadRequested ||= resume; return; }
      pending = true;
      try { await refreshArena(); }
      catch (error) { if (!cancelled) onError((error as Error).message); }
      finally {
        pending = false;
        if (reloadRequested && !cancelled) { reloadRequested = false; void load(); }
      }
    };
    const resume = () => { if (!document.hidden) void load(true); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    void load();
    const timer = setInterval(() => { void load(); }, 3000);
    return () => {
      cancelled = true; ++sequence.current; clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refreshArena, onError]);
  return { arena, refreshArena };
}
