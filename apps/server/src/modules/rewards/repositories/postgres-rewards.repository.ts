import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { RewardsRepository } from '../ports/rewards.repository';

@Injectable()
export class PostgresRewardsRepository extends RewardsRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async claim(battleId: string, characterId: string, experience: number, context: TransactionContext) {
    const receipt = await this.db.session(context).insertInto('battle_rewards')
      .values({ battle_id: battleId, character_id: characterId, experience })
      .onConflict(conflict => conflict.columns(['battle_id', 'character_id']).doNothing())
      .returning('character_id').executeTakeFirst();
    return !!receipt;
  }
}
