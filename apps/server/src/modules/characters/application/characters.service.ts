import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Character, Content, createCharacter, createCharacterSchema, normalizeCharacter, projectCharacterAttributes } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { ContentService } from '../../content/application/content.service';
import { CharactersRepository } from '../ports/characters.repository';

@Injectable()
export class CharactersService {
  constructor(
    @Inject(CharactersRepository) private readonly repository: CharactersRepository,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}

  async list(accountId?: string) {
    const content = await this.content.get();
    return (await this.repository.list(accountId)).map(character => normalizeCharacter(character, content));
  }

  async get(id: string, content?: Content, context?: TransactionContext, lock = false) {
    const character = await this.repository.find(id, context, lock);
    if (!character) throw new NotFoundException('Персонаж не найден');
    return normalizeCharacter(character, content ?? await this.content.get());
  }

  async create(input: unknown, content: Content, context: TransactionContext, accountId: string) {
    const { name, templateId } = createCharacterSchema.parse(input);
    let character: Character;
    try { character = createCharacter(randomUUID(), name, content, templateId); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    character.accountId = accountId;
    await this.repository.create(character, context);
    return character;
  }

  async assertOwned(accountId: string, characterId: string, context?: TransactionContext) {
    const character = await this.repository.find(characterId, context);
    if (!character || character.accountId !== accountId) throw new ForbiddenException('Персонаж не принадлежит выбранному аккаунту');
  }

  /** Mutations participate in the caller's transaction, including rewards and skill purchases. */
  async update(id: string, content: Content, change: (character: Character) => void, context: TransactionContext) {
    const character = await this.get(id, content, context, true);
    change(character);
    Object.assign(character, projectCharacterAttributes(character, content));
    await this.repository.save(character, context);
    return character;
  }
}
