import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { canonicalJson, cargoOfferSchema, cargoManifestIdSchema, publicCargoClaimSchema, worldIdSchema, type AccountSession, type CargoOffer, type CargoImportResult, type CargoImportProof } from '@game/core';
import { UnitOfWork, type TransactionContext } from '../../../shared/application/unit-of-work';
import { MessageBus, MessageFailure } from '../../../shared/application/message-bus';
import { InventoryService } from '../../inventory/application/inventory.service';
import { ContentService } from '../../content/application/content.service';
import { CharactersService } from '../../characters/application/characters.service';
import { WorldJournalService } from '../../world-journal/application/world-journal.service';
import { WorldCargoRepository, type CargoRecord } from '../ports/world-cargo.repository';
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
@Injectable()
export class WorldCargoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldCargoService.name);
  private timer?: ReturnType<typeof setInterval>; private busy?: Promise<void>; private stopping = false;
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork, @Inject(WorldCargoRepository) private readonly repository: WorldCargoRepository,
    @Inject(InventoryService) private readonly inventory: InventoryService, @Inject(ContentService) private readonly content: ContentService,
    @Inject(CharactersService) private readonly characters: CharactersService, @Inject(WorldJournalService) private readonly journal: WorldJournalService,
    @Inject(MessageBus) private readonly bus: MessageBus) {}
  async accept(raw: unknown): Promise<CargoImportResult> {
    const offer = cargoOfferSchema.parse(raw), manifest = offer.manifest;
    if (hash(manifest) !== offer.hash) throw new ConflictException('Хэш груза не совпадает с документом');
    const content = await this.content.get(true);
    return this.transactions.run(async context => {
      if (!await this.journal.registration(manifest.worldId, context)) throw new ForbiddenException('Неизвестная экспедиция');
      await this.characters.assertOwned(manifest.playerId, manifest.characterId, context);
      // Same order as gateway completion: registration -> character -> cargo receipt.
      await this.inventory.state(manifest.characterId, content, context);
      const record = await this.repository.register(offer, context);
      if (record.offer.hash !== offer.hash || canonicalJson(record.offer.manifest) !== canonicalJson(manifest)) throw new ConflictException('Документ груза уже сохранён с другим содержимым');
      return this.import(record, content, context);
    });
  }
  private async import(record: CargoRecord, content: Awaited<ReturnType<ContentService['get']>>, context: TransactionContext): Promise<CargoImportResult> {
    if (record.result?.status === 'imported') return record.result;
    const { manifest, hash: digest } = record.offer;
    const result = await this.inventory.tryReceiveCargo(manifest.characterId, manifest.cargo, content, context);
    const identity = { manifestId: manifest.id, worldId: manifest.worldId, playerId: manifest.playerId, characterId: manifest.characterId, hash: digest };
    if (!result.received) {
      const available: CargoImportResult = { ...identity, status: 'available', reason: result.reason.slice(0, 1000) };
      await this.repository.result(manifest.id, available, context); return available;
    }
    const proof: CargoImportProof = { ...identity, status: 'imported', importedAt: new Date().toISOString() };
    await this.repository.result(manifest.id, proof, context);
    await this.repository.acknowledge(proof, context);
    return proof;
  }
  async claim(session: AccountSession, manifestId: string, raw: unknown) {
    manifestId = cargoManifestIdSchema.parse(manifestId); const command = publicCargoClaimSchema.parse(raw), playerId = session.account.id;
    const content = await this.content.get(true), signature = hash({ manifestId, playerId, characterId: command.characterId });
    const result = await this.transactions.run(async context => {
      const worldId = worldIdSchema.parse(manifestId.split(':')[0]);
      if (!await this.journal.registration(worldId, context)) throw new NotFoundException('Груз не найден');
      await this.characters.assertOwned(playerId, command.characterId, context);
      await this.inventory.state(command.characterId, content, context);
      const receipt = await this.repository.claim(playerId, command.operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException('ID операции уже использован для другого груза');
      if (receipt.result) return receipt.result;
      const record = await this.repository.get(manifestId, context);
      if (!record) throw new NotFoundException('Документ груза ещё не доставлен');
      if (record.offer.manifest.playerId !== playerId || record.offer.manifest.characterId !== command.characterId) throw new ForbiddenException('Груз принадлежит другому персонажу');
      const imported = await this.import(record, content, context);
      if (imported.status === 'imported') await this.repository.finishClaim(playerId, command.operationId, imported, context);
      return imported;
    });
    if (result.status === 'available') throw new ConflictException({ code: 'CARGO_UNAVAILABLE', message: result.reason, manifestId });
    return result;
  }
  async list(session: AccountSession, characterId: string) {
    characterId = worldIdSchema.parse(characterId); await this.characters.assertOwned(session.account.id, characterId);
    return (await this.repository.list(session.account.id, characterId)).map(record => ({ ...record.offer.manifest, hash: record.offer.hash,
      status: record.result?.status ?? 'pending', ...(record.result?.status === 'available' ? { reason: record.result.reason } : {}),
      ...(record.result?.status === 'imported' ? { importedAt: record.result.importedAt } : {}) }));
  }
  async flush() {
    if (this.busy) return this.busy;
    if (this.stopping || !this.bus.enabled()) return;
    this.busy = this.dispatch().finally(() => { this.busy = undefined; }); return this.busy;
  }
  private async dispatch() {
    for (const entry of await this.repository.pending()) {
      if (this.stopping) break;
      try {
        const response = await this.bus.request('world', 'inventory.cargo-imported', `${entry.id}:imported`, entry.proof) as { manifestId?: string; status?: string };
        if (response?.manifestId !== entry.id || response.status !== 'imported') throw new Error('Неверное подтверждение получения груза');
        await this.repository.sent(entry.id);
      } catch (error) {
        await this.repository.failure(entry.id, (error as Error).message, error instanceof MessageFailure && !error.retryable);
        this.logger.warn(`Cargo acknowledgement ${entry.id}: ${(error as Error).message}`);
      }
    }
  }
  onModuleInit() { this.timer = setInterval(() => { void this.flush().catch(error => this.logger.warn((error as Error).message)); }, 1000); this.timer.unref(); void this.flush().catch(error => this.logger.warn((error as Error).message)); }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.busy; }
}
