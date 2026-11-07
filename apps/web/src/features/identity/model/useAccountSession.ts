import { useEffect, useRef, useState } from 'react';
import type { Account, AccountSession } from '@game/core';
import { ApiError, getSessionToken, SESSION_EXPIRED_EVENT, setSessionToken } from '../../../shared/api/http';
import { identityApi } from '../api/identity.api';

export function useAccountSession() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [session, setSession] = useState<AccountSession | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const expired = () => {
      generation.current++; setSessionToken(null); setSession(null); setBusy(false);
      setError('Сессия завершена. Выберите аккаунт снова.');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    const restore = async () => {
      try {
        const [list, current] = await Promise.all([
          identityApi.list(controller.signal),
          getSessionToken() ? identityApi.current(controller.signal).catch(reason => {
            if (reason instanceof ApiError && reason.status === 401) return null;
            throw reason;
          }) : Promise.resolve(null),
        ]);
        if (!cancelled) { setAccounts(list); setSession(current); }
      } catch (reason) { if (!cancelled) setError((reason as Error).message); }
      finally { if (!cancelled) setReady(true); }
    };
    void restore();
    return () => { cancelled = true; generation.current++; controller.abort(); window.removeEventListener(SESSION_EXPIRED_EVENT, expired); };
  }, []);

  const run = async (work: () => Promise<void>) => {
    const attempt = ++generation.current;
    setBusy(true); setError('');
    try { await work(); return true; }
    catch (reason) { if (attempt === generation.current) setError((reason as Error).message); return false; }
    finally { if (attempt === generation.current) setBusy(false); }
  };
  const login = async (accountId: string) => {
    const { token, ...selected } = await identityApi.login(accountId);
    setSessionToken(token); setSession(selected);
  };
  return {
    accounts, session, ready, busy, error,
    chooseAccount: (accountId: string) => run(() => login(accountId)),
    createAccount: (name: string) => run(async () => {
      const account = await identityApi.create(name);
      setAccounts(current => [...current, account]);
      await login(account.id);
    }),
    selectCharacter: (id: string | null) => run(async () => { setSession(await identityApi.selectCharacter(id)); }),
    logout: () => run(async () => {
      try { await identityApi.logout(); }
      finally { setSessionToken(null); setSession(null); }
      setAccounts(await identityApi.list());
    }),
    refreshAccounts: () => run(async () => { setAccounts(await identityApi.list()); }),
  };
}
