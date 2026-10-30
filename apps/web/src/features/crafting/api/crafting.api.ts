import { BlindCraftReceipt, InventoryResult } from '@game/core';
import { request } from '../../../shared/api/http';

import type { CraftingCatalog } from '../model/types';

export const craftingApi = {
  catalog: (ownerId: string) => request<CraftingCatalog>(`/characters/${ownerId}/crafting`),
  apply: (characterId: string, recipeId: string, operationId: string) =>
    request<InventoryResult>(`/characters/${characterId}/crafting/recipes/${recipeId}/apply`, { body: { operationId } }),
  blind: (characterId: string, materials: { itemId: string; quantity: number }[], operationId: string) =>
    request<BlindCraftReceipt>(`/characters/${characterId}/crafting/blind`, { body: { operationId, materials } }),
};
