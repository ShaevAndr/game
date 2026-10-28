import { useCallback, useEffect, useState } from 'react';
import { Battle } from '@game/core';
import { arenaApi } from '../api/arena.api';

export function useRooms(enabled: boolean, onError: (message: string) => void) {
  const [rooms, setRooms] = useState<Battle[]>([]);
  const refreshRooms = useCallback(async () => { setRooms(await arenaApi.list()); }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const next = await arenaApi.list(); if (!cancelled) setRooms(next); }
      catch (error) { if (!cancelled) onError((error as Error).message); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enabled, onError]);
  return { rooms, refreshRooms };
}
