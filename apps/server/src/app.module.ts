import { Module } from '@nestjs/common';
import { CharactersModule } from './modules/characters/characters.module';
import { ContentModule } from './modules/content/content.module';
import { SkillsModule } from './modules/skills/skills.module';
import { ItemsModule } from './modules/items/items.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BattlesModule } from './modules/battles/battles.module';

@Module({ imports: [ContentModule, CharactersModule, SkillsModule, ItemsModule, InventoryModule, BattlesModule] })
export class AppModule {}
