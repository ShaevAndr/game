import { Character } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class CharactersRepository {
  abstract list(): Promise<Character[]>;
  abstract find(id: string, context?: TransactionContext, lock?: boolean): Promise<Character | undefined>;
  abstract create(character: Character): Promise<void>;
  abstract save(character: Character, context: TransactionContext): Promise<void>;
}
