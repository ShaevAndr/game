import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, normalizedWorldCommandSchema, publicWorldStartSchema, worldIdSchema, type AccountSession, type Party, type WorldIdentity } from '@game/core';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { PartiesService } from '../../parties/application/parties.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { ContentService } from '../../content/application/content.service';
import { CharactersService } from '../../characters/application/characters.service';
import { WorldJournalService, worldPartySnapshot, type WorldJournalEntry } from '../../world-journal/application/world-journal.service';
import { WorldRemote } from '../ports/world-remote';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const identity = (party: Party, session: AccountSession): WorldIdentity => {
  const member = party.members.find(member => member.playerId === session.account.id)!;
  return { playerId: member.playerId, characterId: member.characterId, membershipId: member.membershipId, partyId: party.id };
};
@Injectable()
export class WorldGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldGatewayService.name);
  private timer?: ReturnType<typeof setInterval>;
  private readonly drains = new Map<string, Promise<void>>();
  private tick?: Promise<void>;
  private recoveryAfter?: string;
  private stopping = false;
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(PartiesService) private readonly parties: PartiesService, @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ContentService) private readonly content: ContentService, @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(WorldJournalService) private readonly journal: WorldJournalService, @Inject(WorldRemote) private readonly remote: WorldRemote) {}
  private enabled() {
    if (this.stopping) throw new ServiceUnavailableException('Сервер завершает работу');
    if (!this.remote.enabled()) throw new ServiceUnavailableException('Сервис мира не настроен');
  }
  private matching(entry: WorldJournalEntry | null, signature: string) {
    if (entry && entry.signature !== signature) throw new ConflictException('ID операции уже использован с другими параметрами');
    return entry;
  }
  async current(session: AccountSession) {
    return this.transactions.run(async context => {
      const party = await this.parties.worldParty(session, context);
      const registration = party ? await this.journal.active(party.id, context) : null;
      return { worldId: registration?.id ?? null, state: registration?.state ?? null };
    });
  }
  async start(session: AccountSession, raw: unknown) {
    this.enabled(); const request = publicWorldStartSchema.parse(raw), playerId = session.account.id;
    const signature = hash({ kind: 'start', playerId, ...request });
    const entry = await this.transactions.run(async context => {
      let existing = this.matching(await this.journal.operation(request.worldId, playerId, request.operationId, context), signature);
      if (existing) return existing;
      const party = await this.parties.worldAccess(session, context, true);
      existing = this.matching(await this.journal.operation(request.worldId, playerId, request.operationId, context), signature);
      if (existing) return existing;
      if (party.leaderPlayerId !== playerId) throw new ForbiddenException('Создать экспедицию может только лидер');
      if (await this.journal.active(party.id, context) || !await this.journal.create(request.worldId, party.id, context)) throw new ConflictException('У группы уже есть экспедиция или этот ID занят');
      return this.journal.append(request.worldId, { kind: 'start', operationId: request.operationId, actor: identity(party, session), party: worldPartySnapshot(party) },
        playerId, request.operationId, signature, context);
    });
    return this.resolve(entry);
  }
  async execute(session: AccountSession, worldId: string, raw: unknown) {
    this.enabled(); worldId = worldIdSchema.parse(worldId);
    const command = normalizedWorldCommandSchema.parse(raw), playerId = session.account.id;
    const signature = hash({ kind: 'action', worldId, playerId, command });
    const content = await this.content.get(true);
    const entry = await this.transactions.run(async context => {
      let existing = this.matching(await this.journal.operation(worldId, playerId, command.operationId, context), signature);
      if (existing) return existing;
      const party = await this.parties.worldAccess(session, context);
      const registration = await this.journal.registration(worldId, context);
      existing = this.matching(await this.journal.operation(worldId, playerId, command.operationId, context), signature);
      if (existing) return existing;
      if (!registration || registration.partyId !== party.id) throw new ForbiddenException('Нет доступа к экспедиции этой группы');
      if (registration.state !== 'active') throw new ConflictException('Экспедиция завершается или уже закрыта');
      if (command.action.type !== 'harvest' && party.leaderPlayerId !== playerId) throw new ForbiddenException('Отрядом управляет лидер');
      const actor = identity(party, session), admissionId = randomUUID();
      const tool = command.action.type === 'harvest'
        ? await this.inventory.reserveWorldTool(actor.characterId, command.action.toolInstanceId, admissionId, worldId, content, context) : undefined;
      return this.journal.append(worldId, { kind: 'action', party: worldPartySnapshot(party), request: { actor, command, ...(tool ? { tool } : {}) } },
        playerId, command.operationId, signature, context, admissionId);
    });
    return this.resolve(entry);
  }
  private async resolve(entry: WorldJournalEntry) {
    if (!entry.result) await this.drain(entry.delivery.worldId);
    const current = await this.transactions.run(context => this.journal.operation(entry.delivery.worldId, entry.playerId!, entry.operationId!, context));
    if (!current?.result) throw new ServiceUnavailableException({ code: 'WORLD_PENDING', message: 'Результат команды пока неизвестен. Повторите с тем же ID операции', operationId: entry.operationId });
    if (current.result.status >= 400) throw new HttpException(current.result.body, current.result.status);
    return current.result.body;
  }
  async operation(session: AccountSession, worldId: string, operationId: string) {
    worldId = worldIdSchema.parse(worldId); operationId = worldIdSchema.parse(operationId);
    const entry = await this.transactions.run(context => this.journal.operation(worldId, session.account.id, operationId, context));
    if (!entry) throw new NotFoundException('Операция не найдена');
    return { state: entry.result ? 'complete' : 'pending', result: entry.result };
  }
  async get(session: AccountSession, worldId: string) {
    this.enabled(); worldId = worldIdSchema.parse(worldId);
    const access = () => this.transactions.run(async context => {
      const party = await this.parties.worldAccess(session, context), registration = await this.journal.registration(worldId, context);
      if (!registration || registration.partyId !== party.id) throw new ForbiddenException('Нет доступа к экспедиции этой группы');
      return identity(party, session);
    });
    await access(); await this.drain(worldId);
    return this.remote.read(worldId, await access());
  }
  async manifests(session: AccountSession, worldId: string, characterId: string) {
    this.enabled(); worldId = worldIdSchema.parse(worldId); characterId = worldIdSchema.parse(characterId);
    await this.characters.assertOwned(session.account.id, characterId);
    await this.drain(worldId);
    return this.remote.manifests(worldId, session.account.id, characterId);
  }
  async drain(worldId: string): Promise<void> {
    if (this.stopping) return;
    if (this.drains.has(worldId)) return this.drains.get(worldId)!;
    const work = this.deliverPending(worldId).finally(() => this.drains.delete(worldId));
    this.drains.set(worldId, work); return work;
  }
  private async deliverPending(worldId: string) {
    if (!this.remote.enabled()) return;
    for (const entry of await this.journal.pending(worldId)) {
      try {
        const result = await this.remote.deliver(entry.delivery);
        await this.transactions.run(async context => {
          await this.journal.registration(worldId, context);
          const payload = entry.delivery.payload;
          if (payload.kind === 'action' && payload.request.tool)
            await this.inventory.releaseWorldTool(entry.delivery.id, payload.request.tool.ownerCharacterId, context);
          await this.journal.complete(entry, result, context);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'World delivery failed';
        await this.journal.failure(entry.delivery.id, message);
        this.logger.warn(`World delivery ${entry.delivery.id} pending: ${message}`); break;
      }
    }
  }
  onModuleInit() {
    const run = () => {
      if (this.tick || this.stopping || !this.remote.enabled()) return;
      this.tick = this.recover().catch(error => this.logger.warn(`World recovery failed: ${(error as Error).message}`)).finally(() => { this.tick = undefined; });
    };
    this.timer = setInterval(run, 1000); this.timer.unref(); run();
  }
  private async recover() {
    const entries = await this.journal.pending(undefined, this.recoveryAfter);
    this.recoveryAfter = entries.length === 64 ? entries[entries.length - 1].delivery.worldId : undefined;
    const worlds = new Set(entries.map(entry => entry.delivery.worldId));
    for (const worldId of worlds) if (!this.stopping) await this.drain(worldId);
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.tick; await Promise.allSettled(this.drains.values()); }
}
