import { useLiveRefresh } from '../../../shared/model/useLiveRefresh';
import { useEffect, useRef, useState } from 'react';
import type { SocialAction, SocialCommand, SocialState } from '@game/core';
import { ApiError } from '../../../shared/api/http';
import { operationId } from '../../../shared/api/operation-id';
import { socialApi } from '../api/social.api';

export function useSocial(enabled: boolean) {
  const [state, setState] = useState<SocialState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const active = useRef(false), commandPending = useRef(false), current = useRef(state);
  const pending = useRef<{ signature: string; command: SocialCommand } | undefined>(undefined);
  current.current = state;
  const refresh = async (signal?: AbortSignal) => {
    const next = await socialApi.state(signal);
    if (active.current && !signal?.aborted) { setState(previous => previous && previous.revision >= next.revision ? previous : next); setLoadError(''); }
  };
  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    return () => { active.current = false; };
  }, [enabled]);
  useLiveRefresh('social', enabled, refresh, reason => setLoadError(reason.message));

  const act = async (action: SocialAction, targetPlayerId: string) => {
    if (commandPending.current || !enabled) return;
    const signature = JSON.stringify({ action, targetPlayerId });
    if (pending.current?.signature !== signature) pending.current = { signature, command: { operationId: operationId(), targetPlayerId, action,
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
