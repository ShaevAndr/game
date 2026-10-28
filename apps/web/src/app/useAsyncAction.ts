import { useCallback, useRef, useState } from 'react';

export function useAsyncAction(onError: (message: string) => void, recover: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const perform = useCallback(async (task: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onError('');
    try { await task(); }
    catch (error) {
      onError(error instanceof Error ? error.message : 'Ошибка запроса');
      await recover().catch(() => undefined);
    } finally { pending.current = false; setBusy(false); }
  }, [onError, recover]);
  return { busy, perform };
}
