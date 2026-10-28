import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { ContentModule } from '../content/content.module';
import { SkillsModule } from '../skills/skills.module';
import { InventoryService } from './application/inventory.service';
import { InventoryController } from './http/inventory.controller';
import { InventoryRepository } from './ports/inventory.repository';
import { PostgresInventoryRepository } from './repositories/postgres-inventory.repository';

@Module({ imports: [DatabaseModule, CharactersModule, ContentModule, SkillsModule],
  controllers: [InventoryController], providers: [InventoryService, { provide: InventoryRepository, useClass: PostgresInventoryRepository }],
  exports: [InventoryService] })
export class InventoryModule {}
