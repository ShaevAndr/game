import { useContext, useEffect, useRef } from 'react';
import type { StateTopic } from '@game/core';
import { LiveUpdatesContext } from './live-updates';

/** Immediate REST snapshot, subscribe-then-read recovery, and offline-only fallback. */
export function useLiveRefresh(topic: StateTopic, enabled: boolean,
  refresh: (signal: AbortSignal) => Promise<unknown>, onError?: (error: Error) => void, identity = '') {
  const live = useContext(LiveUpdatesContext);
  const current = useRef({ refresh, onError, connected: live.connected });
  current.current = { refresh, onError, connected: live.connected };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let pending = false, queued = false;
    const load = async () => {
      if (controller.signal.aborted) return;
      if (document.hidden) { queued = true; return; }
      if (pending) { queued = true; return; }
      pending = true; queued = false;
      try { await current.current.refresh(controller.signal); }
      catch (reason) { if (!controller.signal.aborted) current.current.onError?.(reason as Error); }
      finally { pending = false; if (queued && !controller.signal.aborted && !document.hidden) void load(); }
    };
    const unsubscribe = live.subscribe(topic, () => { void load(); });
    const resume = () => { if (!document.hidden) void load(); };
    void load();
    const timer = setInterval(() => { if (!current.current.connected && !document.hidden) void load(); }, 30_000);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { controller.abort(); unsubscribe(); clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [topic, enabled, live.subscribe, identity]);
}
