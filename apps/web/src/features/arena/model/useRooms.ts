import { useCallback, useEffect, useState } from 'react';
import { Battle } from '@game/core';
import { arenaApi } from '../api/arena.api';

export function useRooms(enabled: boolean, onError: (message: string) => void) {
  const [rooms, setRooms] = useState<Battle[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshRooms = useCallback(async () => {
    try { setRooms(await arenaApi.list()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const next = await arenaApi.list(); if (!cancelled) setRooms(next); }
      catch (error) { if (!cancelled) onError((error as Error).message); }
      finally { pending = false; if (!cancelled) setLoading(false); }
    };
    const resume = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [enabled, onError]);
  return { rooms, loading, refreshRooms };
}
