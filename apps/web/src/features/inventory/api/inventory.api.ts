import { Item, ItemStack } from '@game/core';
import { request } from '../../../shared/api/http';

export const inventoryApi = {
  get: (characterId: string) => request<(ItemStack & { item: Item | null })[]>(`/characters/${characterId}/inventory`),
};
