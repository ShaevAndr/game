import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { ContentModule } from '../content/content.module';
import { SkillsCatalogModule } from './skills-catalog.module';
import { SkillsService } from './application/skills.service';
import { SkillsController } from './http/skills.controller';

@Module({ imports: [DatabaseModule, CharactersModule, ContentModule, SkillsCatalogModule],
  controllers: [SkillsController], providers: [SkillsService], exports: [SkillsService] })
export class SkillsModule {}
