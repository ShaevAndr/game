import { useCallback, useEffect, useRef, useState } from 'react';
import { gatheringCommandSchema, type GatheringAction, type GatheringCommand, type GatheringView } from '@game/core';
import { ApiError } from '../../../shared/api/http';
import { operationId } from '../../../shared/api/operation-id';
import { gatheringApi } from '../api/gathering.api';

function restore(key: string): GatheringCommand | null {
  try { return gatheringCommandSchema.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null')); }
  catch { return null; }
}

export function useGathering(ownerId: string, onError: (message: string) => void) {
  const key = `gathering-operation:${ownerId}`;
  const [view, setView] = useState<GatheringView | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<GatheringCommand | null>(() => restore(key));
  const sending = useRef(false);
  const refresh = useCallback(async () => { setView(await gatheringApi.get(ownerId)); }, [ownerId]);
  useEffect(() => {
    const controller = new AbortController();
    void gatheringApi.get(ownerId, controller.signal).then(setView).catch(error => { if (!controller.signal.aborted) onError(error.message); });
    return () => controller.abort();
  }, [ownerId, onError]);

  const send = async (command: GatheringCommand) => {
    if (sending.current) return;
    sending.current = true;
    setMessage('');
    setPending(command); sessionStorage.setItem(key, JSON.stringify(command));
    try {
      const result = await gatheringApi.execute(ownerId, command);
      setView(result.view); setPending(null); sessionStorage.removeItem(key);
      const loot = result.outcome.loot.map(item => `${item.quantity} × ${result.view.itemNames[item.itemId] ?? item.itemId}`).join(', ');
      setMessage(result.outcome.type === 'return' ? loot ? `В рюкзак доставлено: ${loot}.` : 'Вы вернулись из вылазки.'
        : result.outcome.type === 'harvest' ? result.outcome.success ? `В груз добавлено: ${loot}.` : 'Добыча не удалась. Можно продолжить путь.'
        : result.outcome.type === 'start' ? 'Маршрут открыт. Выберите находку и способ добычи.' : 'Вы перешли к следующей остановке.');
      // A replay can return a historical receipt; GET always restores the latest revision.
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) { setPending(null); sessionStorage.removeItem(key); }
      await refresh().catch(() => undefined);
      throw error;
    } finally { sending.current = false; }
  };
  const act = async (action: GatheringAction) => {
    if (!view || pending || sending.current) return;
    await send({ operationId: operationId(), expectedRevision: view.revision, action });
  };
  const retry = async () => { if (pending) await send(pending); };
  return { view, message, pending: !!pending, refresh, act, retry };
}
