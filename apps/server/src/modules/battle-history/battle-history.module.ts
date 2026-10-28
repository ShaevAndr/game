import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { QueuesModule } from '../../infrastructure/queues/queues.module';
import { BattleHistoryService } from './application/battle-history.service';
import { BattleArchiveOutbox, BattleHistoryRepository } from './ports/battle-history.repository';
import { PostgresBattleArchiveOutbox } from './repositories/postgres-battle-archive-outbox';
import { MongoBattleHistoryRepository } from './repositories/mongo-battle-history.repository';

@Module({ imports: [DatabaseModule, MongoModule, QueuesModule],
  providers: [BattleHistoryService, { provide: BattleArchiveOutbox, useClass: PostgresBattleArchiveOutbox },
    { provide: BattleHistoryRepository, useClass: MongoBattleHistoryRepository }], exports: [BattleHistoryService] })
export class BattleHistoryModule {}
