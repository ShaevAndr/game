import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { applyWorldCommand, createVoxelWorld, defaultWorldSettings, initialWorldCatalog, seedContent, worldView, type WorldActor } from '@game/core';
import { UnitOfWork, type TransactionContext } from '../../../shared/application/unit-of-work';
import { canonicalJson } from '../../../shared/application/canonical-json';
import { executeWorldSchema, startWorldSchema, worldIdSchema, worldIdentitySchema, type WorldCommandResult, type WorldIdentity } from '../../../shared/application/world-contracts';
import { WorldRepository, type WorldRecord } from '../ports/world.repository';

const signature = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

@Injectable()
export class WorldService {
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork, @Inject(WorldRepository) private readonly repository: WorldRepository) {}

  private actor(record: WorldRecord, identity: WorldIdentity): WorldActor {
    if (record.state.partyId !== identity.partyId || !record.members.some(member => member.playerId === identity.playerId
      && member.characterId === identity.characterId && member.membershipId === identity.membershipId))
      throw new ForbiddenException('Нет доступа к сохранённому составу экспедиции');
    return { ...identity, isLeader: identity.playerId === record.ownerPlayerId && identity.characterId === record.ownerCharacterId };
  }
  private replay(receipt: { signature: string; result: WorldCommandResult } | null, expected: string): WorldCommandResult | undefined {
    if (!receipt) return;
    if (receipt.signature !== expected) throw new ConflictException('ID операции уже использован с другими параметрами');
    return receipt.result;
  }

  async start(raw: unknown): Promise<WorldCommandResult> {
    return this.transactions.run(context => this.startInTransaction(raw, context));
  }
  async startInTransaction(raw: unknown, context: TransactionContext): Promise<WorldCommandResult> {
    const request = startWorldSchema.parse(raw);
    request.members.sort((a, b) => a.characterId.localeCompare(b.characterId));
    const hash = signature({ type: 'start', request });
      await this.repository.lockParty(request.actor.partyId, context);
      const existing = await this.repository.load(request.worldId, context);
      if (existing) {
        this.actor(existing, request.actor);
        const replay = this.replay(await this.repository.receipt(request.worldId, request.actor.playerId, request.operationId, context), hash);
        if (replay) return replay;
        throw new ConflictException('Этот ID мира уже занят');
      }
      if (await this.repository.activeWorld(request.actor.partyId, context)) throw new ConflictException('У группы уже есть активная экспедиция');
      const progress = await this.repository.progress(request.members, context);
      if (progress.some(entry => entry.playerId !== request.members.find(member => member.characterId === entry.characterId)!.playerId))
        throw new ForbiddenException('Владелец прогресса не совпадает');
      const state = createVoxelWorld({ id: request.worldId, partyId: request.actor.partyId, seed: randomInt(0x100000000),
        catalog: initialWorldCatalog, settings: defaultWorldSettings, items: seedContent.items, gatherers: progress });
      if (!await this.repository.create({ state, members: request.members, ownerPlayerId: request.actor.playerId, ownerCharacterId: request.actor.characterId, partyRevision: 0, ownerFence: 0 }, context))
        throw new ConflictException('Этот ID мира уже занят');
      const result: WorldCommandResult = { worldId: state.id, operationId: request.operationId, revision: 0,
        outcome: { type: 'start', success: true, loot: [], xpGained: 0, manifestIds: [] } };
      await this.repository.finish(state.id, request.actor.playerId, hash, result, [], context);
      return result;
  }

  async execute(worldId: string, raw: unknown): Promise<WorldCommandResult> {
    return this.transactions.run(context => this.executeInTransaction(worldId, raw, context));
  }
  async executeInTransaction(worldId: string, raw: unknown, context: TransactionContext): Promise<WorldCommandResult> {
    worldId = worldIdSchema.parse(worldId);
    const request = executeWorldSchema.parse(raw);
    const hash = signature({ type: 'action', worldId, request });
      const record = await this.repository.load(worldId, context);
      if (!record) throw new NotFoundException('Экспедиция не найдена');
      const actor = this.actor(record, request.actor);
      const replay = this.replay(await this.repository.receipt(worldId, actor.playerId, request.command.operationId, context), hash);
      if (replay) return replay;
      if (record.state.revision !== request.command.expectedRevision) throw new ConflictException('Состояние мира изменилось; перечитайте снимок');
      let transition: ReturnType<typeof applyWorldCommand>;
      try { transition = applyWorldCommand(record.state, request.command, actor, request.tool); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      if (!await this.repository.save(transition.state, record.state.revision, context)) throw new ConflictException('Состояние мира изменилось');
      await this.repository.seal(transition.outcome.manifests, context);
      const result: WorldCommandResult = { worldId, operationId: request.command.operationId, revision: transition.state.revision,
        outcome: { type: transition.outcome.type, success: transition.outcome.success, loot: transition.outcome.loot,
          xpGained: transition.outcome.xpGained, manifestIds: transition.outcome.manifests.filter(manifest => manifest.characterId === actor.characterId).map(manifest => manifest.id) } };
      await this.repository.finish(worldId, actor.playerId, hash, result, transition.outcome.rolls, context);
      return result;
  }

  async get(worldId: string, rawIdentity: unknown) {
    worldId = worldIdSchema.parse(worldId);
    const identity = worldIdentitySchema.parse(rawIdentity);
    return this.transactions.run(async context => {
      const record = await this.repository.load(worldId, context);
      if (!record) throw new NotFoundException('Экспедиция не найдена');
      return { ...worldView(record.state, this.actor(record, identity)), partyRevision: record.partyRevision,
        ownerFence: record.ownerFence, leaderPlayerId: record.ownerPlayerId, members: record.members };
    });
  }
  async manifests(worldId: string, rawIdentity: unknown) {
    worldId = worldIdSchema.parse(worldId);
    const identity = worldIdentitySchema.pick({ playerId: true, characterId: true }).parse(rawIdentity);
    return this.transactions.run(async context => {
      const record = await this.repository.load(worldId, context);
      if (!record) throw new NotFoundException('Экспедиция не найдена');
      return this.repository.manifests(worldId, identity.playerId, identity.characterId, context);
    });
  }
  async health() { await this.transactions.run(context => this.repository.ready(context)); return { status: 'ok' }; }
}
