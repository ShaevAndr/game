import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BattlesService } from './battles.service';

@Injectable()
export class BattleTimeoutService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BattleTimeoutService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@Inject(BattlesService) private readonly battles: BattlesService) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    void this.tick();
  }
  tick(): Promise<void> {
    return this.running ??= this.battles.expireTurns().catch(error => {
      this.logger.error('Не удалось обработать таймеры боя', error instanceof Error ? error.stack : String(error));
    }).finally(() => { this.running = undefined; });
  }
  async onModuleDestroy() { clearInterval(this.timer); await this.running; }
}
