import { useCallback, useEffect, useRef, useState } from 'react';
import { partyCommandSchema, type AccountSession, type PartyAction, type PartyCommand, type PartyState } from '@game/core';
import { ApiError } from '../../../shared/api/http';
import { operationId } from '../../../shared/api/operation-id';
import { partiesApi } from '../api/parties.api';

function restore(key: string): PartyCommand | null {
  try { return partyCommandSchema.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null')); } catch { return null; }
}
const actionNames: Record<PartyAction['type'], string> = { invite: 'Приглашение отправлено.', accept: 'Вы вступили в группу.', decline: 'Приглашение отклонено.', cancel: 'Приглашение отменено.',
  transfer: 'Лидерство передано.', kick: 'Участник исключён.', leave: 'Вы вышли из группы.', disband: 'Группа распущена.', 'change-character': 'Персонаж группы обновлён.' };

export function useParty(session: AccountSession | null) {
  const enabled = !!session?.characterId;
  const key = `party-operation:${session?.account.id ?? ''}:${session?.characterId ?? ''}`;
  const [state, setState] = useState<PartyState | null>(null), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PartyCommand | null>(null), [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [message, setMessage] = useState('');
  const [clientNow, setClientNow] = useState(Date.now()), offset = useRef(0);
  const activeKey = useRef(key), current = useRef(state), pendingRef = useRef(pending), sending = useRef(false), sequence = useRef(0), applied = useRef(0);
  activeKey.current = key; current.current = state; pendingRef.current = pending;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const attempt = ++sequence.current, next = await partiesApi.state(signal);
    if (activeKey.current === key && !signal?.aborted && attempt >= applied.current) {
      applied.current = attempt; offset.current = next.serverTime - Date.now(); current.current = next; setState(next); setLoadError('');
    }
  }, [key]);
  useEffect(() => {
    setState(null); current.current = null; setError(''); setLoadError(''); setMessage(''); setClientNow(Date.now());
    const restored = enabled ? restore(key) : null; setPending(restored); pendingRef.current = restored;
    if (!enabled) return;
    let loading = false; const controller = new AbortController();
    const load = async () => {
      if (loading) return; loading = true;
      try { await refresh(controller.signal); } catch (reason) { if (!controller.signal.aborted) setLoadError((reason as Error).message); }
      finally { loading = false; }
    };
    void load(); const timer = setInterval(() => { void load(); }, 2000), clock = setInterval(() => setClientNow(Date.now()), 1000);
    window.addEventListener('focus', load);
    return () => { controller.abort(); clearInterval(timer); clearInterval(clock); window.removeEventListener('focus', load); };
  }, [key, enabled, refresh]);

  const send = async (command: PartyCommand) => {
    if (!enabled || sending.current) return;
    const requestKey = key;
    sending.current = true; setBusy(true); setError(''); setMessage('');
    pendingRef.current = command; setPending(command); sessionStorage.setItem(key, JSON.stringify(command));
    try {
      await partiesApi.command(command);
      sessionStorage.removeItem(requestKey);
      if (activeKey.current !== requestKey) return;
      pendingRef.current = null; setPending(null); setMessage(actionNames[command.action.type]);
      await refresh();
    } catch (reason) {
      if (activeKey.current !== requestKey) return;
      if (reason instanceof ApiError && reason.status < 500) { pendingRef.current = null; setPending(null); sessionStorage.removeItem(requestKey); }
      setError((reason as Error).message); await refresh().catch(() => undefined);
    } finally { sending.current = false; setBusy(false); }
  };
  const act = async (action: PartyAction) => {
    if (!current.current || pendingRef.current || sending.current) return;
    await send({ operationId: operationId(), expectedPartyId: current.current.party?.id ?? null, expectedRevision: current.current.party?.revision ?? 0, action });
  };
  const incoming = state?.incoming.filter(invitation => invitation.expiresAt > clientNow + offset.current) ?? [];
  return { state, busy, pending: !!pending, error: error || loadError, message, incoming, serverNow: clientNow + offset.current,
    act, invite: (targetPlayerId: string) => { void act({ type: 'invite', targetPlayerId }); }, retry: () => { if (pendingRef.current) void send(pendingRef.current); },
    refresh: () => { void refresh().catch(reason => setLoadError((reason as Error).message)); } };
}
