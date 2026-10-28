import { Battle } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class BattleArchiveOutbox {
  abstract stage(battle: Battle, context: TransactionContext): Promise<void>;
  abstract pending(limit: number): Promise<Battle[]>;
  abstract delivered(id: string): Promise<void>;
}

export abstract class BattleHistoryRepository {
  abstract archive(battle: Battle): Promise<void>;
}
