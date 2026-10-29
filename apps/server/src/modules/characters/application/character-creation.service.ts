import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { ContentService } from '../../content/application/content.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { CharactersService } from './characters.service';

@Injectable()
export class CharacterCreationService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}

  async create(input: unknown) {
    const content = await this.content.get(true);
    return this.transactions.run(async context => {
      const character = await this.characters.create(input, content, context);
      await this.inventory.initialize(character.id, content, context);
      return character;
    });
  }
}
