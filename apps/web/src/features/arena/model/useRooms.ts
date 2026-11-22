import { useLiveRefresh } from '../../../shared/model/useLiveRefresh';
import { useCallback, useState } from 'react';
import { Battle } from '@game/core';
import { arenaApi } from '../api/arena.api';

export function useRooms(enabled: boolean, onError: (message: string) => void) {
  const [rooms, setRooms] = useState<Battle[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshRooms = useCallback(async (signal?: AbortSignal) => {
    try { const next = await arenaApi.list(signal); if (!signal?.aborted) setRooms(next); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useLiveRefresh('rooms', enabled, refreshRooms, error => onError(error.message));
  return { rooms, loading, refreshRooms };
}
