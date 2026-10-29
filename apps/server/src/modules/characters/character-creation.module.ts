import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ContentModule } from '../content/content.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CharactersModule } from './characters.module';
import { CharacterCreationService } from './application/character-creation.service';
import { CharacterCreationController } from './http/character-creation.controller';

@Module({
  imports: [DatabaseModule, ContentModule, CharactersModule, InventoryModule],
  controllers: [CharacterCreationController], providers: [CharacterCreationService],
})
export class CharacterCreationModule {}
