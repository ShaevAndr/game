import { useCallback, useEffect, useRef, useState } from 'react';
import { CraftingResult, InventoryView, RecipeIngredient } from '@game/core';
import { inventoryApi } from '../../inventory/api/inventory.api';
import { craftingApi, CraftingCatalog } from '../api/crafting.api';
import { ApiError } from '../../../shared/api/http';
import { operationId } from '../../../shared/api/operation-id';

export function useCrafting(ownerId: string, onError: (message: string) => void) {
  const [view, setView] = useState<InventoryView | null>(null);
  const [catalog, setCatalog] = useState<CraftingCatalog | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const attempts = useRef(new Map<string, { id: string; committed: boolean; result?: CraftingResult }>());

  const refresh = useCallback(async () => {
    if (ownerId) setView(await inventoryApi.get(ownerId));
  }, [ownerId]);

  useEffect(() => {
    setView(null); setSelection({});
    if (!ownerId) return;
    let cancelled = false;
    void Promise.all([inventoryApi.get(ownerId), craftingApi.catalog()]).then(([inventory, recipes]) => {
      if (!cancelled) { setView(inventory); setCatalog(recipes); }
    }).catch(error => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; };
  }, [ownerId, onError]);

  const materials = (): RecipeIngredient[] => Object.entries(selection)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));

  const execute = async <T extends CraftingResult,>(signature: string, send: (id: string) => Promise<T>): Promise<T> => {
    const attempt: { id: string; committed: boolean; result?: CraftingResult } = attempts.current.get(signature) ?? { id: operationId(), committed: false };
    attempts.current.set(signature, attempt);
    try {
      if (!attempt.committed) { attempt.result = await send(attempt.id); attempt.committed = true; }
      await refresh();
      attempts.current.delete(signature);
      return attempt.result as T;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && !attempt.committed) attempts.current.delete(signature);
      await refresh().catch(() => undefined);
      throw error;
    }
  };

  const craft = (recipeId: string) => execute(`craft:${recipeId}`, id => craftingApi.apply(ownerId, recipeId, id));
  const experiment = () => execute(`blind:${JSON.stringify(materials())}`, id => craftingApi.blind(ownerId, materials(), id));
  const setQuantity = (itemId: string, quantity: number) => setSelection(current => ({ ...current, [itemId]: quantity }));

  return { view, catalog, selection, materials: materials(), setQuantity, craft, experiment, refresh };
}
