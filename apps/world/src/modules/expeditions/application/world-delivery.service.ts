import { ConflictException, ForbiddenException, HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { applyWorldCommand, canonicalJson, worldDeliverySchema, type WorldCommandResult, type WorldDeliveryResult, type WorldPartySnapshot } from '@game/core';
import { UnitOfWork, type TransactionContext } from '../../../shared/application/unit-of-work';
import { WorldRepository, type WorldRecord } from '../ports/world.repository';
import { WorldService } from './world.service';

@Injectable()
export class WorldDeliveryService {
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork, @Inject(WorldRepository) private readonly repository: WorldRepository,
    @Inject(WorldService) private readonly worlds: WorldService) {}
  async deliver(raw: unknown): Promise<WorldDeliveryResult> {
    const delivery = worldDeliverySchema.parse(raw);
    const signature = createHash('sha256').update(canonicalJson(delivery)).digest('hex');
    return this.transactions.run(async context => {
      await this.repository.lockDeliveries(delivery.worldId, context);
      const previous = await this.repository.delivery(delivery.worldId, delivery.sequence, context);
      if (previous) {
        if (previous.id !== delivery.id || previous.signature !== signature) throw new ConflictException('Номер допуска уже занят другой командой');
        return previous.result;
      }
      if (delivery.sequence !== 1 + await this.repository.lastDelivery(delivery.worldId, context))
        throw new ConflictException({ code: 'WORLD_DELIVERY_GAP', message: 'Сначала доставьте предыдущий допуск' });
      let result: WorldDeliveryResult;
      try {
        const payload = delivery.payload;
        if (payload.kind !== 'party') {
          const actor = payload.kind === 'start' ? payload.actor : payload.request.actor;
          if (actor.partyId !== payload.party.id || !payload.party.members.some(member => member.playerId === actor.playerId
            && member.characterId === actor.characterId && member.membershipId === actor.membershipId)) throw new ForbiddenException('Допуск не соответствует составу группы');
        }
        if (payload.kind === 'start') {
          if (delivery.sequence !== 1) throw new ConflictException('Экспедиция уже была создана');
          if (payload.actor.playerId !== payload.party.leaderPlayerId) throw new ForbiddenException('Создавать мир может лидер');
          const body = await this.worlds.startInTransaction({ worldId: delivery.worldId, operationId: payload.operationId,
            actor: payload.actor, members: payload.party.members }, context);
          const record = (await this.repository.load(delivery.worldId, context))!;
          record.partyRevision = payload.party.revision; record.ownerFence = 1;
          await this.repository.roster(record, context);
          result = { status: 201, body };
        } else {
          const record = await this.repository.load(delivery.worldId, context, payload.party?.members);
          if (!record) throw new ConflictException('Экспедиция ещё не создана');
          await this.reconcile(record, payload.party, context);
          if (payload.kind === 'action') result = { status: 201, body: await this.worlds.executeInTransaction(delivery.worldId, payload.request, context) };
          else {
            const body: WorldCommandResult = { worldId: delivery.worldId, operationId: delivery.id, revision: record.state.revision,
              outcome: { type: 'party', success: true, loot: [], xpGained: 0, manifestIds: [] } };
            result = { status: 200, body };
          }
        }
      } catch (error) {
        if (!(error instanceof HttpException) || ![400, 403, 404, 409].includes(error.getStatus())) throw error;
        result = { status: error.getStatus(), body: { message: error.message } };
      }
      await this.repository.finishDelivery(delivery.worldId, delivery.sequence, delivery.id, signature, result, context);
      return result;
    });
  }
  private async reconcile(record: WorldRecord, party: WorldPartySnapshot | null, context: TransactionContext) {
    if (record.state.status === 'closed') return;
    const previousRevision = record.state.revision;
    if (!party) {
      const transition = applyWorldCommand(record.state, { operationId: record.state.id, expectedRevision: previousRevision, action: { type: 'close' } }, {
        playerId: record.ownerPlayerId, characterId: record.ownerCharacterId, membershipId: record.members.find(member => member.playerId === record.ownerPlayerId)?.membershipId ?? record.state.id,
        partyId: record.state.partyId, isLeader: true,
      });
      if (!await this.repository.save(transition.state, previousRevision, context)) throw new Error('Concurrent world projection update');
      await this.repository.seal(transition.outcome.manifests, context);
      record.state = transition.state; record.members = []; record.ownerFence++;
      await this.repository.roster(record, context); return;
    }
    if (party.id !== record.state.partyId || party.revision < record.partyRevision) throw new ConflictException('Устаревший состав группы');
    const leader = party.members.find(member => member.playerId === party.leaderPlayerId)!;
    const sorted = (members: WorldRecord['members']) => [...members].sort((a, b) => a.characterId.localeCompare(b.characterId));
    const ownerChanged = leader.playerId !== record.ownerPlayerId || leader.characterId !== record.ownerCharacterId;
    const changed = ownerChanged || canonicalJson(sorted(record.members)) !== canonicalJson(sorted(party.members));
    if (changed && party.revision === record.partyRevision) throw new ConflictException('Состав группы не соответствует её ревизии');
    if (changed) {
      if (record.state.revision >= Number.MAX_SAFE_INTEGER || record.ownerFence >= Number.MAX_SAFE_INTEGER) throw new ConflictException('Исчерпана ревизия мира');
      record.state.revision++;
      const manifests = [];
      for (const old of record.members) if (!party.members.some(member => member.playerId === old.playerId && member.characterId === old.characterId && member.membershipId === old.membershipId)) {
        const gatherer = record.state.gatherers.find(entry => entry.characterId === old.characterId)!;
        if (gatherer.cargo.length) manifests.push({ id: `${record.state.id}:${gatherer.characterId}:${record.state.revision}`,
          worldId: record.state.id, playerId: gatherer.playerId, characterId: gatherer.characterId, cargo: structuredClone(gatherer.cargo) });
        gatherer.cargo = [];
      }
      const progress = await this.repository.progress(party.members, context);
      for (const member of party.members) if (!record.state.gatherers.some(entry => entry.characterId === member.characterId)) {
        const saved = progress.find(entry => entry.characterId === member.characterId)!;
        if (saved.playerId !== member.playerId) throw new ForbiddenException('Владелец прогресса не совпадает');
        record.state.gatherers.push({ ...saved, cargo: [] });
      }
      record.members = party.members;
      if (ownerChanged) record.ownerFence++;
      record.ownerPlayerId = leader.playerId; record.ownerCharacterId = leader.characterId; record.partyRevision = party.revision;
      await this.repository.roster(record, context);
      if (!await this.repository.save(record.state, previousRevision, context)) throw new Error('Concurrent world projection update');
      await this.repository.seal(manifests, context);
    } else if (record.partyRevision !== party.revision) {
      record.partyRevision = party.revision; await this.repository.roster(record, context);
    }
  }
}
