import { useCallback, useRef, useState } from 'react';

export type AsyncTask = () => Promise<void>;
export type ActionRunner = (task: AsyncTask, recoverPage?: AsyncTask) => Promise<void>;

export function useAsyncAction(onError: (message: string) => void, recover: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const perform = useCallback<ActionRunner>(async (task, recoverPage) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onError('');
    try { await task(); }
    catch (error) {
      onError(error instanceof Error ? error.message : 'Ошибка запроса');
      await Promise.allSettled([recover(), recoverPage?.()]);
    } finally { pending.current = false; setBusy(false); }
  }, [onError, recover]);
  return { busy, perform };
}
