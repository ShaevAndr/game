import type { StateTopic } from '@game/core';
import type { TransactionContext } from './unit-of-work';

export interface StateChange {
  topics: StateTopic[];
  accountIds?: string[];
  characterIds?: string[];
}
/** Metadata only. Context-bound notifications are delivered after a successful commit. */
export abstract class StateChanges {
  abstract publish(change: StateChange, context?: TransactionContext): void;
  abstract subscribe(listener: (change: StateChange) => void): () => void;
}
