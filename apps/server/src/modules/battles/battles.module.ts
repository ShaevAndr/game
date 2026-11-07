import { Module } from '@nestjs/common';
import { BattlefieldModule } from '../battlefield/battlefield.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { ContentModule } from '../content/content.module';
import { RewardsModule } from '../rewards/rewards.module';
import { BattleHistoryModule } from '../battle-history/battle-history.module';
import { BattlesService } from './application/battles.service';
import { BattleEvents } from './ports/battle-events';
import { BattleParticipationModule } from './battle-participation.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BattleTimeoutService } from './application/battle-timeout.service';
import { BattleRuntime } from './ports/battle-runtime';
import { SystemBattleRuntime } from './repositories/system-battle-runtime';
import { BattlesController } from './http/battles.controller';
import { BattlesGateway } from './http/battles.gateway';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [BattlefieldModule, DatabaseModule, CharactersModule, ContentModule, RewardsModule, BattleHistoryModule, BattleParticipationModule, InventoryModule, IdentityModule],
  controllers: [BattlesController],
  providers: [BattlesService, BattleTimeoutService, BattlesGateway, { provide: BattleEvents, useExisting: BattlesGateway },
    { provide: BattleRuntime, useClass: SystemBattleRuntime }],
  exports: [BattlesService],
})
export class BattlesModule {}
