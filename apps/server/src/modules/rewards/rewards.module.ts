import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { RewardsService } from './application/rewards.service';
import { RewardsRepository } from './ports/rewards.repository';
import { PostgresRewardsRepository } from './repositories/postgres-rewards.repository';

@Module({ imports: [DatabaseModule, CharactersModule],
  providers: [RewardsService, { provide: RewardsRepository, useClass: PostgresRewardsRepository }], exports: [RewardsService] })
export class RewardsModule {}
