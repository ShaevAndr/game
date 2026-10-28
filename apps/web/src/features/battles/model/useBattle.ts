import { useCallback, useEffect, useState } from 'react';
import { Battle } from '@game/core';
import { io } from 'socket.io-client';
import { battlesApi } from '../api/battles.api';

/** REST loads and recovers snapshots. The socket exists only while viewing a battle. */
export function useBattle(roomId: string, onError: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<Battle | null>(null);
  const [connected, setConnected] = useState(false);
  const updateBattle = useCallback((value: Battle) => {
    if (value.id !== roomId) return;
    setSnapshot(current => !current || current.id !== value.id || value.version >= current.version ? value : current);
  }, [roomId]);

  const refreshBattle = useCallback(async () => {
    if (roomId) updateBattle(await battlesApi.get(roomId));
  }, [roomId, updateBattle]);

  useEffect(() => {
    setSnapshot(null);
    setConnected(false);
    if (!roomId) return;
    let cancelled = false;
    let pending = false;
    let reloadRequested = false;
    const controller = new AbortController();
    const socket = io({ autoConnect: false });
    const load = async (afterSubscription = false) => {
      if (cancelled) return;
      if (pending) { reloadRequested ||= afterSubscription; return; }
      pending = true;
      try { const battle = await battlesApi.get(roomId, controller.signal); if (!cancelled) updateBattle(battle); }
      catch (error) { if (!cancelled) onError((error as Error).message); }
      finally {
        pending = false;
        if (reloadRequested && !cancelled) { reloadRequested = false; void load(); }
      }
    };
    const receive = (battle: Battle) => { if (!cancelled) updateBattle(battle); };
    socket.on('battle', receive);
    socket.on('connect', () => {
      if (cancelled) return;
      setConnected(true);
      socket.timeout(5000).emit('watch', roomId, (error: Error | null, result: { ok?: boolean; error?: string }) => {
        if (cancelled) return;
        if (error || !result?.ok) { setConnected(false); onError(result?.error ?? 'Не удалось подписаться на бой'); }
        void load(true);
      });
    });
    socket.on('disconnect', () => { if (!cancelled) setConnected(false); });
    socket.on('connect_error', () => { if (!cancelled) setConnected(false); });
    // Initial REST loading never waits for a working WebSocket connection.
    void load();
    socket.connect();
    // Reconciliation also repairs a missed last event; all commands remain HTTP.
    const timer = setInterval(() => { void load(); }, 5000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      socket.emit('unwatch');
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [roomId, onError, updateBattle]);

  return { battle: snapshot?.id === roomId ? snapshot : null, connected, updateBattle, refreshBattle };
}
