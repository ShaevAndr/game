import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class RewardsRepository {
  abstract claim(battleId: string, characterId: string, experience: number, context: TransactionContext): Promise<boolean>;
}
