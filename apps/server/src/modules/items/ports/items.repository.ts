import { Item, ItemGroup, ItemRank, defaultItemRanks, defaultItemScalingProfiles, type ItemScalingProfile } from '@game/core';

export abstract class ItemsRepository {
  async ranks(): Promise<ItemRank[]> { return defaultItemRanks; }
  async scalingProfiles(): Promise<ItemScalingProfile[]> { return defaultItemScalingProfiles; }
  abstract list(): Promise<Item[]>;
  abstract groups(): Promise<ItemGroup[]>;
}
