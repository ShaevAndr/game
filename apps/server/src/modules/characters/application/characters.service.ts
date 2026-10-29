import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Character, Content, createCharacter, createCharacterSchema, normalizeCharacter } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { ContentService } from '../../content/application/content.service';
import { CharactersRepository } from '../ports/characters.repository';

@Injectable()
export class CharactersService {
  constructor(
    @Inject(CharactersRepository) private readonly repository: CharactersRepository,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}

  async list() {
    const content = await this.content.get();
    return (await this.repository.list()).map(character => normalizeCharacter(character, content));
  }

  async get(id: string, content?: Content, context?: TransactionContext, lock = false) {
    const character = await this.repository.find(id, context, lock);
    if (!character) throw new NotFoundException('Персонаж не найден');
    return normalizeCharacter(character, content ?? await this.content.get());
  }

  async create(input: unknown, content: Content, context: TransactionContext) {
    const { name, templateId } = createCharacterSchema.parse(input);
    let character: Character;
    try { character = createCharacter(randomUUID(), name, content, templateId); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    await this.repository.create(character, context);
    return character;
  }

  /** Mutations participate in the caller's transaction, including rewards and skill purchases. */
  async update(id: string, content: Content, change: (character: Character) => void, context: TransactionContext) {
    const character = await this.get(id, content, context, true);
    change(character);
    await this.repository.save(character, context);
    return character;
  }
}
