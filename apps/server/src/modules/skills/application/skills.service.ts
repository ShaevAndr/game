import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { learnSkill } from '@game/core';
import { z } from 'zod';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { CharactersService } from '../../characters/application/characters.service';
import { ContentService } from '../../content/application/content.service';
import { SkillsCatalogService } from './skills-catalog.service';

const learnSchema = z.object({ skillId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }).strict();

@Injectable()
export class SkillsService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(SkillsCatalogService) private readonly catalog: SkillsCatalogService,
  ) {}

  list() { return this.catalog.list(); }
  get(id: string) { return this.catalog.get(id); }

  async learn(characterId: string, input: unknown) {
    const { skillId } = learnSchema.parse(input);
    const content = await this.content.get(true);
    return this.transactions.run(context => this.characters.update(characterId, content, character => {
      try { learnSkill(character, skillId, content); }
      catch (error) { throw new BadRequestException((error as Error).message); }
    }, context));
  }
}
