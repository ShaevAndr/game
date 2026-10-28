import { Item, ItemGroup } from '@game/core';

export abstract class ItemsRepository {
  abstract list(): Promise<Item[]>;
  abstract groups(): Promise<ItemGroup[]>;
}
