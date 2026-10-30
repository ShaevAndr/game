import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { allocateAttributes, statIdSchema } from '@game/core';
import { z } from 'zod';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { ContentService } from '../../content/application/content.service';
import { CharactersService } from './characters.service';

const allocationSchema = z.object({
  allocations: z.record(statIdSchema, z.number().int().min(1).max(1000)).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 64),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

@Injectable()
export class CharacterDevelopmentService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}
  async allocate(ownerId: string, input: unknown) {
    const { allocations, expectedRevision } = allocationSchema.parse(input);
    const content = await this.content.get(true);
    return this.transactions.run(context => this.characters.update(ownerId, content, character => {
      if ((character.attributeRevision ?? 0) !== expectedRevision) throw new ConflictException('Характеристики изменились. Обновите персонажа.');
      try { Object.assign(character, allocateAttributes(character, allocations, content)); }
      catch (error) { throw new BadRequestException((error as Error).message); }
    }, context));
  }
}
