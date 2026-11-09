import { Module } from '@nestjs/common';
import { CharactersModule } from './modules/characters/characters.module';
import { CharacterCreationModule } from './modules/characters/character-creation.module';
import { ContentModule } from './modules/content/content.module';
import { SkillsModule } from './modules/skills/skills.module';
import { ItemsModule } from './modules/items/items.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CraftingModule } from './modules/crafting/crafting.module';
import { BattlesModule } from './modules/battles/battles.module';
import { IdentityAccessModule } from './modules/identity/identity-access.module';
import { ChatModule } from './modules/chat/chat.module';
import { GatheringModule } from './modules/gathering/gathering.module';
import { PartiesModule } from './modules/parties/parties.module';
import { WorldGatewayModule } from './modules/world-gateway/world-gateway.module';
import { WorldCargoModule } from './modules/world-cargo/world-cargo.module';

@Module({ imports: [IdentityAccessModule, ContentModule, CharactersModule, CharacterCreationModule, SkillsModule, ItemsModule, InventoryModule, CraftingModule, GatheringModule, PartiesModule, BattlesModule, ChatModule, WorldGatewayModule, WorldCargoModule] })
export class AppModule {}
