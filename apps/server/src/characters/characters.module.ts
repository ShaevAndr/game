import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Character, createCharacter, createCharacterSchema, learnSkill, normalizeCharacter } from '@game/core';
import { z } from 'zod';
import { Database } from '../database/database.module';
import { ContentService } from '../content/content.module';

@Injectable()
export class CharactersService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(ContentService) private readonly content: ContentService) {}
  async list() {
    const content = await this.content.get();
    return (await this.db.sql.selectFrom('characters').select('data').execute()).map(row => normalizeCharacter(row.data, content));
  }
  async create(input: unknown) {
    const { name, templateId } = createCharacterSchema.parse(input);
    const content = await this.content.get();
    let character: Character;
    try { character = createCharacter(randomUUID(), name, content, templateId); } catch (error) { throw new BadRequestException((error as Error).message); }
    await this.db.sql.insertInto('characters').values({ id: character.id, data: JSON.stringify(character) }).execute(); return character;
  }
  async learn(id: string, input: unknown) {
    const { skillId } = z.object({ skillId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }).strict().parse(input);
    const content = await this.content.get();
    return this.db.sql.transaction().execute(async tx => {
      const row = await tx.selectFrom('characters').select('data').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw new NotFoundException('Персонаж не найден');
      const character = normalizeCharacter(row.data, content);
      try { learnSkill(character, skillId, content); } catch (error) { throw new BadRequestException((error as Error).message); }
      await tx.updateTable('characters').set({ data: JSON.stringify(character) }).where('id', '=', id).execute();
      return character;
    });
  }
}
@Controller('characters')
class CharactersController {
  constructor(@Inject(CharactersService) private readonly service: CharactersService) {}
  @Get() list() { return this.service.list(); }
  @Post() create(@Body() body: unknown) { return this.service.create(body); }
  @Post(':id/skills') learn(@Param('id') id: string, @Body() body: unknown) { return this.service.learn(z.string().uuid().parse(id), body); }
}
@Module({ controllers: [CharactersController], providers: [CharactersService] })
export class CharactersModule {}
