import { Module } from '@nestjs/common';
import { WorldDatabaseModule } from '../../infrastructure/database/world-database.module';
import { ServiceTokenGuard } from '../../shared/http/service-token.guard';
import { WorldService } from './application/world.service';
import { WorldController, WorldHealthController } from './http/world.controller';
import { WorldDeliveryService } from './application/world-delivery.service';
import { WorldRepository } from './ports/world.repository';
import { PostgresWorldRepository } from './repositories/postgres-world.repository';
import { RabbitMessagingModule } from '../../infrastructure/rabbitmq/rabbit-messaging.module';
import { WorldMessageController } from './http/world-message.controller';
import { WorldCargoService } from './application/world-cargo.service';
import { WorldCargoRepository } from './ports/world-cargo.repository';
import { PostgresWorldCargoRepository } from './repositories/postgres-world-cargo.repository';

@Module({ imports: [WorldDatabaseModule, RabbitMessagingModule], controllers: [WorldController, WorldHealthController],
  providers: [WorldService, WorldDeliveryService, WorldCargoService, WorldMessageController, ServiceTokenGuard,
    { provide: WorldCargoRepository, useClass: PostgresWorldCargoRepository }, { provide: WorldRepository, useClass: PostgresWorldRepository }], exports: [WorldService] })
export class ExpeditionsModule {}
