import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { BattleParticipationService } from './application/battle-participation.service';
import { BattlesRepository } from './ports/battles.repository';
import { PostgresBattlesRepository } from './repositories/postgres-battles.repository';

@Module({ imports: [DatabaseModule],
  providers: [BattleParticipationService, { provide: BattlesRepository, useClass: PostgresBattlesRepository }],
  exports: [BattleParticipationService, BattlesRepository] })
export class BattleParticipationModule {}
