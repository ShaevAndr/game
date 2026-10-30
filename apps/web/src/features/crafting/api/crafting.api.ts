import { BlindCraftReceipt, BlindCraftRules, CraftingRecipe, InventoryResult } from '@game/core';
import { request } from '../../../shared/api/http';

export interface CraftingCatalog { recipes: CraftingRecipe[]; blind: BlindCraftRules }

export const craftingApi = {
  catalog: () => request<CraftingCatalog>('/crafting/recipes'),
  apply: (characterId: string, recipeId: string, operationId: string) =>
    request<InventoryResult>(`/characters/${characterId}/crafting/recipes/${recipeId}/apply`, { body: { operationId } }),
  blind: (characterId: string, materials: { itemId: string; quantity: number }[], operationId: string) =>
    request<BlindCraftReceipt>(`/characters/${characterId}/crafting/blind`, { body: { operationId, materials } }),
};
