import { Injectable, Logger } from '@nestjs/common';
import { StateChanges, type StateChange } from '../../shared/application/state-changes';
import type { TransactionContext } from '../../shared/application/unit-of-work';

@Injectable()
export class InProcessStateChanges extends StateChanges {
  private readonly listeners = new Set<(change: StateChange) => void>();
  private readonly logger = new Logger(InProcessStateChanges.name);
  publish(change: StateChange, context?: TransactionContext) {
    if (context) { context.afterCommit?.(() => this.publish(change)); return; }
    for (const listener of this.listeners) {
      try { listener(change); } catch { this.logger.warn('State notification failed; REST can recover the snapshot'); }
    }
  }
  subscribe(listener: (change: StateChange) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
