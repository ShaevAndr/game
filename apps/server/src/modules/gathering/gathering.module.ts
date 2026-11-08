import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ContentModule } from '../content/content.module';
import { InventoryModule } from '../inventory/inventory.module';
import { GatheringService } from './application/gathering.service';
import { GatheringController } from './http/gathering.controller';
import { GatheringRepository } from './ports/gathering.repository';
import { PostgresGatheringRepository } from './repositories/postgres-gathering.repository';

@Module({
  imports: [DatabaseModule, ContentModule, InventoryModule],
  controllers: [GatheringController],
  providers: [GatheringService, { provide: GatheringRepository, useClass: PostgresGatheringRepository }],
  exports: [GatheringService],
})
export class GatheringModule {}
