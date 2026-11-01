import { Battle } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class BattlesRepository {
  abstract list(): Promise<Battle[]>;
  abstract find(id: string): Promise<Battle | undefined>;
  abstract hasActiveCharacter(characterId: string, context?: TransactionContext): Promise<boolean>;
  abstract create(battle: Battle): Promise<void>;
  abstract lock(id: string, context: TransactionContext): Promise<{ battle: Battle; version: number } | undefined>;
  abstract save(battle: Battle, context: TransactionContext): Promise<void>;
}
