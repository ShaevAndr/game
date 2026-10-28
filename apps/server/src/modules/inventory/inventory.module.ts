import { Module } from '@nestjs/common';
import { CharactersModule } from '../characters/characters.module';
import { ItemsModule } from '../items/items.module';
import { InventoryService } from './application/inventory.service';
import { InventoryController } from './http/inventory.controller';

@Module({ imports: [CharactersModule, ItemsModule], controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
