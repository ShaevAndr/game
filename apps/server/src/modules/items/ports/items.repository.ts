import { Item, ItemGroup, ItemRank, defaultItemRanks } from '@game/core';

export abstract class ItemsRepository {
  async ranks(): Promise<ItemRank[]> { return defaultItemRanks; }
  abstract list(): Promise<Item[]>;
  abstract groups(): Promise<ItemGroup[]>;
}
