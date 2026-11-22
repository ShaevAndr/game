import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { stateTopics, type StateTopic } from '@game/core';
import { LiveUpdatesContext } from '../../../shared/model/live-updates';
import { getSessionToken } from '../../../shared/api/http';

/** One account channel per authenticated app; pages own their topic subscriptions. */
export function LiveUpdatesProvider({ children, characterId }: { children: ReactNode; characterId: string | null }) {
  const listeners = useRef(new Map<StateTopic, Set<() => void>>());
  const synchronize = useRef<() => void>(() => {});
  const [connected, setConnected] = useState(false);
  const subscribe = useCallback((topic: StateTopic, listener: () => void) => {
    const group = listeners.current.get(topic) ?? new Set<() => void>();
    group.add(listener); listeners.current.set(topic, group); synchronize.current();
    return () => { group.delete(listener); if (!group.size) listeners.current.delete(topic); synchronize.current(); };
  }, []);
  useEffect(() => {
    setConnected(false);
    let disposed = false, generation = 0;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const acknowledged = new Set<StateTopic>();
    const socket = io('/updates', { autoConnect: false, auth: { token: getSessionToken() } });
    const sync = () => {
      clearTimeout(scheduled);
      scheduled = setTimeout(() => {
        if (disposed || !socket.connected) return;
        const attempt = ++generation, topics = [...listeners.current.keys()];
        socket.timeout(5000).emit('subscribe', topics, (error: Error | null, result?: { ok?: boolean }) => {
          if (disposed || attempt !== generation || !socket.connected) return;
          setConnected(!error && !!result?.ok);
          if (error || !result?.ok) { acknowledged.clear(); return; }
          const added = topics.filter(topic => !acknowledged.has(topic));
          acknowledged.clear(); topics.forEach(topic => acknowledged.add(topic));
          // Read after ACK closes the gap between initial REST and subscription.
          for (const topic of added) for (const listener of listeners.current.get(topic) ?? []) listener();
        });
      }, 0);
    };
    synchronize.current = sync;
    socket.on('state.changed', (event: { topics?: unknown }) => {
      if (!Array.isArray(event?.topics)) return;
      for (const topic of new Set(event.topics)) if (stateTopics.includes(topic as StateTopic))
        for (const listener of listeners.current.get(topic as StateTopic) ?? []) listener();
    });
    socket.on('connect', () => { acknowledged.clear(); sync(); });
    const disconnected = () => { generation++; acknowledged.clear(); if (!disposed) setConnected(false); };
    socket.on('disconnect', disconnected); socket.on('connect_error', disconnected);
    const heartbeat = setInterval(() => {
      if (!socket.connected) { socket.connect(); return; }
      socket.timeout(5000).emit('heartbeat', (error: Error | null, result?: { ok?: boolean }) => {
        if (disposed) return;
        if (error || !result?.ok) { setConnected(false); socket.disconnect().connect(); }
        else if (!acknowledged.size && listeners.current.size) sync();
      });
    }, 20_000);
    socket.connect();
    return () => {
      disposed = true; synchronize.current = () => {}; clearTimeout(scheduled); clearInterval(heartbeat);
      socket.removeAllListeners(); socket.disconnect();
    };
  }, [characterId]);
  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <LiveUpdatesContext.Provider value={value}>{children}</LiveUpdatesContext.Provider>;
}
