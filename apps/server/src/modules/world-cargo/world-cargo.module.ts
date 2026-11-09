import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { RabbitMessagingModule } from '../../infrastructure/rabbitmq/rabbit-messaging.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ContentModule } from '../content/content.module';
import { CharactersModule } from '../characters/characters.module';
import { WorldJournalModule } from '../world-journal/world-journal.module';
import { WorldCargoService } from './application/world-cargo.service';
import { WorldCargoRepository } from './ports/world-cargo.repository';
import { PostgresWorldCargoRepository } from './repositories/postgres-world-cargo.repository';
import { WorldCargoController, WorldCargoMessageController } from './http/world-cargo.controller';
@Module({ imports: [DatabaseModule, RabbitMessagingModule, InventoryModule, ContentModule, CharactersModule, WorldJournalModule],
  controllers: [WorldCargoController], providers: [WorldCargoService, WorldCargoMessageController, { provide: WorldCargoRepository, useClass: PostgresWorldCargoRepository }] })
export class WorldCargoModule {}
