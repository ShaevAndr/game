import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account, AccountSession } from '@game/core';
import { ApiError, getSessionToken, SESSION_EXPIRED_EVENT, setSessionToken } from '../../../shared/api/http';
import { identityApi } from '../api/identity.api';

type IsCurrent = () => boolean;

export function useAccountSession() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [session, setSession] = useState<AccountSession | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), pending = useRef(false);
  const restore = useCallback(async (current: IsCurrent, signal?: AbortSignal) => {
    const [list, selected] = await Promise.allSettled([
      identityApi.list(signal),
      getSessionToken() ? identityApi.current(signal).catch(reason => {
        if (reason instanceof ApiError && reason.status === 401) return null;
        throw reason;
      }) : Promise.resolve(null),
    ]);
    if (!current()) return;
    if (list.status === 'fulfilled') setAccounts(list.value);
    if (selected.status === 'fulfilled') setSession(selected.value);
    if (selected.status === 'rejected') throw selected.reason;
    if (list.status === 'rejected') throw list.reason;
  }, []);
  useEffect(() => {
    const attempt = ++generation.current;
    const controller = new AbortController();
    const expired = () => {
      const expiredAttempt = ++generation.current;
      pending.current = false; setSessionToken(null); setSession(null); setBusy(false);
      setError('Сессия завершена. Выберите аккаунт снова.');
      void identityApi.list(controller.signal).then(list => { if (expiredAttempt === generation.current) setAccounts(list); }).catch(() => undefined);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    void restore(() => attempt === generation.current, controller.signal)
      .catch(reason => { if (attempt === generation.current) setError((reason as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setReady(true); });
    return () => { generation.current++; controller.abort(); window.removeEventListener(SESSION_EXPIRED_EVENT, expired); };
  }, [restore]);

  const run = async (work: (current: IsCurrent) => Promise<void>) => {
    if (pending.current || !ready) return false;
    const attempt = ++generation.current;
    const current = () => attempt === generation.current;
    pending.current = true; setBusy(true); setError('');
    try { await work(current); return current(); }
    catch (reason) { if (current()) setError((reason as Error).message); return false; }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  };
  const login = async (accountId: string, current: IsCurrent) => {
    const { token, ...selected } = await identityApi.login(accountId);
    if (current()) { setSessionToken(token); setSession(selected); }
  };
  return {
    accounts, session, ready, busy, error,
    chooseAccount: (accountId: string) => run(current => login(accountId, current)),
    createAccount: (name: string) => run(async current => {
      const account = await identityApi.create(name);
      if (!current()) return;
      setAccounts(previous => [...previous, account]);
      await login(account.id, current);
    }),
    selectCharacter: (id: string | null) => run(async current => {
      const selected = await identityApi.selectCharacter(id);
      if (current()) setSession(selected);
    }),
    logout: () => run(async current => {
      try { await identityApi.logout(); }
      finally { if (current()) { setSessionToken(null); setSession(null); } }
      const list = await identityApi.list();
      if (current()) setAccounts(list);
    }),
    refreshAccounts: () => run(current => restore(current)),
  };
}
