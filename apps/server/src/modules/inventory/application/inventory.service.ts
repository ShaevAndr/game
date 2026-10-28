import { Inject, Injectable } from '@nestjs/common';
import { CharactersService } from '../../characters/application/characters.service';
import { ItemsService } from '../../items/application/items.service';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(ItemsService) private readonly items: ItemsService,
  ) {}

  async get(characterId: string) {
    const [character, items] = await Promise.all([this.characters.get(characterId), this.items.list()]);
    return character.inventory.map(stack => ({ ...stack, item: items.find(item => item.id === stack.itemId) ?? null }));
  }
}
