import { OnModuleDestroy, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Battle } from '@game/core';
import { TaskQueue } from '../../../shared/application/task-queue.port';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { BattleArchiveOutbox, BattleHistoryRepository } from '../ports/battle-history.repository';

const queueName = 'battle-archive';

@Injectable()
export class BattleHistoryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BattleHistoryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private dispatching?: Promise<void>;

  constructor(
    @Inject(BattleArchiveOutbox) private readonly outbox: BattleArchiveOutbox,
    @Inject(BattleHistoryRepository) private readonly history: BattleHistoryRepository,
    @Inject(TaskQueue) private readonly queue: TaskQueue,
  ) {}

  stage(battle: Battle, context: TransactionContext) { return this.outbox.stage(battle, context); }

  onApplicationBootstrap() {
    this.queue.consume<{ battle: Battle }>(queueName, ({ battle }) => this.history.archive(battle));
    this.timer = setInterval(() => { void this.dispatch(); }, 1000);
    void this.dispatch();
  }

  dispatch(): Promise<void> {
    if (this.dispatching) return this.dispatching;
    this.dispatching = this.deliver().catch(() => {
      this.logger.warn('Archive delivery deferred; pending events remain in PostgreSQL');
    }).finally(() => { this.dispatching = undefined; });
    return this.dispatching;
  }

  private async deliver() {
    for (const battle of await this.outbox.pending(50)) {
      await this.queue.enqueue(queueName, battle.id, { battle });
      await this.outbox.delivered(battle.id);
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.dispatching;
  }
}
