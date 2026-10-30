import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { grantSkill, learnSkill, skillLevel, skillMagnitude, skillPower, skillProgression, upgradeSkill } from '@game/core';
import { z } from 'zod';
import { TransactionContext, UnitOfWork } from '../../../shared/application/unit-of-work';
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

  async owned(characterId: string) {
    const content = await this.content.get();
    const character = await this.characters.get(characterId, content);
    return content.skills.filter(skill => skillLevel(character, skill.id) > 0).map(skill => ({
      ...skill, level: skillLevel(character, skill.id),
      power: skillPower(skill, skillLevel(character, skill.id)), progression: skillProgression(skill),
      ...(character.attributes ? { magnitude: skillMagnitude(skill, skillLevel(character, skill.id), character.attributes.effective, content.balance.attributes?.skillReferencePower) } : {}),
    }));
  }

  async upgrade(characterId: string, skillId: string, input: unknown) {
    const { expectedLevel } = z.object({ expectedLevel: z.number().int().min(1).max(10) }).strict().parse(input);
    const content = await this.content.get(true);
    return this.transactions.run(context => this.characters.update(characterId, content, character => {
      if (skillLevel(character, skillId) !== expectedLevel) throw new ConflictException('Уровень навыка изменился. Обновите персонажа.');
      try { upgradeSkill(character, skillId, content); }
      catch (error) { throw new BadRequestException((error as Error).message); }
    }, context));
  }

  /** Only trusted server scenarios call grants; clients learn using points or consume a scroll. */
  async grant(characterId: string, skillId: string, context?: TransactionContext) {
    const content = await this.content.get(true);
    const apply = async (transaction: TransactionContext) => {
      let granted = false;
      const character = await this.characters.update(characterId, content, character => {
        try { granted = grantSkill(character, skillId, content); }
        catch (error) { throw new BadRequestException((error as Error).message); }
      }, transaction);
      return { character, granted };
    };
    return context ? apply(context) : this.transactions.run(apply);
  }

  async learn(characterId: string, input: unknown) {
    const { skillId } = learnSchema.parse(input);
    const content = await this.content.get(true);
    return this.transactions.run(context => this.characters.update(characterId, content, character => {
      try { learnSkill(character, skillId, content); }
      catch (error) { throw new BadRequestException((error as Error).message); }
    }, context));
  }
}
