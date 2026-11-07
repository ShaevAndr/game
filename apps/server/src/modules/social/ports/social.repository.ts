import type { SocialPair, SocialRelationship } from '@game/core';
import type { TransactionContext } from '../../../shared/application/unit-of-work';

export interface SocialPlayer { id: string; revision: number; visibilityRevision: number }
export abstract class SocialRepository {
  abstract claim(playerId: string, operationId: string, signature: string, context: TransactionContext): Promise<{ signature: string; result: SocialRelationship | null }>;
  abstract lockPlayers(ids: string[], context: TransactionContext): Promise<SocialPlayer[]>;
  abstract pair(one: string, two: string, context?: TransactionContext): Promise<SocialPair | undefined>;
  abstract pairs(playerId: string, context: TransactionContext): Promise<SocialPair[]>;
  abstract save(pair: SocialPair, players: SocialPlayer[], context: TransactionContext): Promise<void>;
  abstract complete(playerId: string, operationId: string, result: SocialRelationship, context: TransactionContext): Promise<void>;
}
