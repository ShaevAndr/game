import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { cargoImportProofSchema, cargoImportResultSchema, canonicalJson, type CargoImportResult, type CargoOffer } from '@game/core';
import { UnitOfWork, type TransactionContext } from '../../../shared/application/unit-of-work';
import { MessageBus, MessageFailure } from '../../../shared/application/message-bus';
import { WorldCargoRepository } from '../ports/world-cargo.repository';
@Injectable()
export class WorldCargoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldCargoService.name);
  private timer?: ReturnType<typeof setInterval>; private busy?: Promise<void>; private stopping = false;
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork, @Inject(WorldCargoRepository) private readonly repository: WorldCargoRepository,
    @Inject(MessageBus) private readonly bus: MessageBus) {}
  private async record(result: CargoImportResult, context: TransactionContext) {
    const saved = await this.repository.lock(result.manifestId, context);
    if (!saved) throw new NotFoundException('Манифест груза не найден');
    const manifest = saved.offer.manifest;
    if (saved.offer.hash !== result.hash || manifest.worldId !== result.worldId || manifest.playerId !== result.playerId || manifest.characterId !== result.characterId)
      throw new ConflictException('Подтверждение не соответствует грузу');
    if (saved.result?.status === 'imported') {
      if (result.status === 'imported' && canonicalJson(saved.result) !== canonicalJson(result)) throw new ConflictException('Подтверждение груза уже сохранено с другим содержимым');
      return;
    }
    await this.repository.result(manifest.id, result, context);
  }
  async imported(raw: unknown) {
    const proof = cargoImportProofSchema.parse(raw);
    await this.transactions.run(async context => { await this.record(proof, context); await this.repository.sent(proof.manifestId, context); });
    return { manifestId: proof.manifestId, status: 'imported' };
  }
  async flush() {
    if (this.busy) return this.busy;
    if (this.stopping || !this.bus.enabled()) return;
    this.busy = this.dispatch().finally(() => { this.busy = undefined; }); return this.busy;
  }
  private async dispatch() {
    for (const offer of await this.repository.pending()) {
      if (this.stopping) break;
      try {
        const result = cargoImportResultSchema.parse(await this.bus.request('server', 'inventory.import-expedition-cargo', `${offer.manifest.id}:offer`, offer));
        if (result.manifestId !== offer.manifest.id || result.hash !== offer.hash) throw new MessageFailure('Ответ относится к другому грузу', false, 'MESSAGE_RESULT');
        await this.transactions.run(async context => { await this.record(result, context); await this.repository.sent(offer.manifest.id, context); });
      } catch (error) {
        await this.repository.failure(offer.manifest.id, (error as Error).message, error instanceof MessageFailure && !error.retryable);
        this.logger.warn(`Cargo offer ${offer.manifest.id}: ${(error as Error).message}`);
      }
    }
  }
  onModuleInit() { this.timer = setInterval(() => { void this.flush().catch(error => this.logger.warn((error as Error).message)); }, 1000); this.timer.unref(); void this.flush().catch(error => this.logger.warn((error as Error).message)); }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.busy; }
}
