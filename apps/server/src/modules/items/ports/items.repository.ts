import { Item } from '@game/core';

export abstract class ItemsRepository {
  abstract list(): Promise<Item[]>;
}
