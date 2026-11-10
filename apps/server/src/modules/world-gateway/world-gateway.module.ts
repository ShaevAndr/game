import { WorldCargoModule } from '../world-cargo/world-cargo.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { PartiesModule } from '../parties/parties.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CharactersModule } from '../characters/characters.module';
import { ContentModule } from '../content/content.module';
import { WorldJournalModule } from '../world-journal/world-journal.module';
import { WorldGatewayService } from './application/world-gateway.service';
import { WorldGatewayController } from './http/world-gateway.controller';
import { WorldRemote } from './ports/world-remote';
import { RabbitWorldRemote } from './repositories/rabbit-world-remote';
import { RabbitMessagingModule } from '../../infrastructure/rabbitmq/rabbit-messaging.module';
@Module({ imports: [DatabaseModule, PartiesModule, InventoryModule, CharactersModule, ContentModule, WorldJournalModule, RabbitMessagingModule, WorldCargoModule], controllers: [WorldGatewayController],
  providers: [WorldGatewayService, { provide: WorldRemote, useClass: RabbitWorldRemote }], exports: [WorldGatewayService] })
export class WorldGatewayModule {}
