import { CharactersModule } from '../characters/characters.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ContentModule } from '../content/content.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CraftingCatalogModule } from './crafting-catalog.module';
import { CraftingService } from './application/crafting.service';
import { CraftingController } from './http/crafting.controller';
import { CraftingOperationsRepository } from './ports/crafting-operations.repository';
import { PostgresCraftingOperationsRepository } from './repositories/postgres-crafting-operations.repository';

@Module({
  imports: [CharactersModule, DatabaseModule, ContentModule, InventoryModule, CraftingCatalogModule],
  controllers: [CraftingController],
  providers: [CraftingService, { provide: CraftingOperationsRepository, useClass: PostgresCraftingOperationsRepository }],
  exports: [CraftingService],
})
export class CraftingModule {}
