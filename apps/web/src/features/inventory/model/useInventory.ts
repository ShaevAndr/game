import { useCallback, useEffect, useRef, useState } from 'react';
import { InventoryView } from '@game/core';
import { inventoryApi, ClientInventoryCommand } from '../api/inventory.api';
import { ApiError } from '../../../shared/api/http';
import { operationId } from '../../../shared/api/operation-id';

export function useInventory(ownerId: string, onError: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<InventoryView | null>(null);
  const attempts = useRef(new Map<string, { id: string; committed: boolean }>());
  const refresh = useCallback(async () => {
    if (ownerId) setSnapshot(await inventoryApi.get(ownerId));
  }, [ownerId]);
  useEffect(() => {
    setSnapshot(null);
    if (!ownerId) return;
    let cancelled = false;
    void inventoryApi.get(ownerId).then(view => { if (!cancelled) setSnapshot(view); }).catch(error => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; };
  }, [ownerId, onError]);

  const execute = async (command: ClientInventoryCommand, afterRefresh: () => Promise<void>) => {
    const key = JSON.stringify(command);
    const attempt = attempts.current.get(key) ?? { id: operationId(), committed: false };
    attempts.current.set(key, attempt);
    try {
      if (!attempt.committed) { await inventoryApi.execute(command, attempt.id); attempt.committed = true; }
      await refresh();
      await afterRefresh();
      attempts.current.delete(key);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && !attempt.committed) attempts.current.delete(key);
      await Promise.allSettled([refresh(), afterRefresh()]);
      throw error;
    }
  };
  return { view: snapshot?.ownerId === ownerId ? snapshot : null, refresh, execute };
}
