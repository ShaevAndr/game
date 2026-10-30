import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CharacterTemplatesModule } from '../characters/character-templates.module';
import { SkillsCatalogModule } from '../skills/skills-catalog.module';
import { ItemsModule } from '../items/items.module';
import { CraftingCatalogModule } from '../crafting/crafting-catalog.module';
import { ContentService } from './application/content.service';
import { ContentController } from './http/content.controller';
import { ContentSettingsRepository } from './ports/content-settings.repository';
import { MongoContentSettingsRepository } from './repositories/mongo-content-settings.repository';
import { CharacteristicsCatalogModule } from '../characters/characteristics-catalog.module';

@Module({
  imports: [MongoModule, RedisModule, CharacterTemplatesModule, SkillsCatalogModule, ItemsModule, CraftingCatalogModule, CharacteristicsCatalogModule],
  controllers: [ContentController],
  providers: [ContentService, { provide: ContentSettingsRepository, useClass: MongoContentSettingsRepository }],
  exports: [ContentService],
})
export class ContentModule {}
