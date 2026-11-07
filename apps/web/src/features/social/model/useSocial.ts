import { useEffect, useRef, useState } from 'react';
import type { SocialAction, SocialCommand, SocialState } from '@game/core';
import { ApiError } from '../../../shared/api/http';
import { socialApi } from '../api/social.api';

export function useSocial(enabled: boolean) {
  const [state, setState] = useState<SocialState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const active = useRef(false), commandPending = useRef(false), current = useRef(state);
  const pending = useRef<{ signature: string; command: SocialCommand } | undefined>(undefined);
  current.current = state;
  const refresh = async (signal?: AbortSignal) => {
    const next = await socialApi.state(signal);
    if (active.current && !signal?.aborted) setState(previous => previous && previous.revision >= next.revision ? previous : next);
  };
  useEffect(() => {
    if (!enabled) return;
    active.current = true; const controller = new AbortController(); let loading = false;
    const load = async () => {
      if (loading) return; loading = true;
      try { await refresh(controller.signal); if (!controller.signal.aborted) setLoadError(''); }
      catch (reason) { if (!controller.signal.aborted) setLoadError((reason as Error).message); }
      finally { loading = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active.current = false; controller.abort(); clearInterval(timer); };
  }, [enabled]);
  const act = async (action: SocialAction, targetPlayerId: string) => {
    if (commandPending.current || !enabled) return;
    const signature = JSON.stringify({ action, targetPlayerId });
    if (pending.current?.signature !== signature) pending.current = { signature, command: { operationId: crypto.randomUUID(), targetPlayerId, action,
      expectedRevision: current.current?.relationships.find(row => row.playerId === targetPlayerId)?.revision ?? 0 } };
    commandPending.current = true; setBusy(true); setError('');
    try { await socialApi.command(pending.current.command); pending.current = undefined; await refresh(); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) { pending.current = undefined; await refresh().catch(() => {}); }
      if (active.current) setError((reason as Error).message);
    } finally { commandPending.current = false; setBusy(false); }
  };
  return { state, busy, error: error || loadError, act };
}
