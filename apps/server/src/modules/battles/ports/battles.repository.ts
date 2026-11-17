import { ArenaChallenge, ArenaState, Battle } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export abstract class BattlesRepository {
  abstract lockMatchmaking(context: TransactionContext): Promise<void>;
  abstract arenaState(characterId: string, context: TransactionContext): Promise<ArenaState>;
  abstract challenge(id: string, context: TransactionContext): Promise<ArenaChallenge | undefined>;
  abstract pendingChallenge(battleId: string, challengerId: string, context: TransactionContext): Promise<ArenaChallenge | undefined>;
  abstract saveChallenge(challenge: ArenaChallenge, context: TransactionContext): Promise<void>;
  abstract cancelChallenges(characterIds: string[], context: TransactionContext): Promise<void>;
  abstract list(onlineCharacterIds: string[]): Promise<Battle[]>;
  abstract find(id: string): Promise<Battle | undefined>;
  abstract hasActiveCharacter(characterId: string, context?: TransactionContext): Promise<boolean>;
  abstract expired(now: number, limit: number): Promise<string[]>;
  abstract create(battle: Battle): Promise<void>;
  /** Remove a locked waiting room and its offers in the caller's transaction. */
  abstract removeRoom(id: string, context: TransactionContext): Promise<void>;
  abstract lock(id: string, context: TransactionContext): Promise<{ battle: Battle; version: number } | undefined>;
  abstract save(battle: Battle, context: TransactionContext): Promise<void>;
}
