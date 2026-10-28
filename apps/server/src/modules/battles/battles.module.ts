import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { ContentModule } from '../content/content.module';
import { RewardsModule } from '../rewards/rewards.module';
import { BattleHistoryModule } from '../battle-history/battle-history.module';
import { BattlesService } from './application/battles.service';
import { BattlesRepository } from './ports/battles.repository';
import { BattleEvents } from './ports/battle-events';
import { PostgresBattlesRepository } from './repositories/postgres-battles.repository';
import { BattlesController } from './http/battles.controller';
import { BattlesGateway } from './http/battles.gateway';

@Module({
  imports: [DatabaseModule, CharactersModule, ContentModule, RewardsModule, BattleHistoryModule],
  controllers: [BattlesController],
  providers: [BattlesService, BattlesGateway, { provide: BattleEvents, useExisting: BattlesGateway },
    { provide: BattlesRepository, useClass: PostgresBattlesRepository }],
})
export class BattlesModule {}
