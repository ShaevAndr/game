import type { WorldCargoManifest, VoxelWorld, WorldDeliveryResult } from '@game/core';
import { WorldDeliveryService } from '../../src/modules/expeditions/application/world-delivery.service';
import type { TransactionContext } from '../../src/shared/application/unit-of-work';
import { UnitOfWork } from '../../src/shared/application/unit-of-work';
import type { WorldCommandResult, WorldMember } from '../../src/shared/application/world-contracts';
import { WorldRepository, type WorldRecord } from '../../src/modules/expeditions/ports/world.repository';
import { WorldService } from '../../src/modules/expeditions/application/world.service';

interface Data {
  worlds: Map<string, WorldRecord>;
  progress: Map<string, { playerId: string; characterId: string; xp: number }>;
  receipts: Map<string, { signature: string; result: WorldCommandResult; rolls: number[] }>;
  manifests: Map<string, WorldCargoManifest>;
  deliveries: Map<string, { id: string; signature: string; result: WorldDeliveryResult; sequence: number; worldId: string }>;
}
export function memoryWorld() {
  let data: Data = { worlds: new Map(), progress: new Map(), receipts: new Map(), manifests: new Map(), deliveries: new Map() };
  let tail = Promise.resolve(); let failure: 'finish' | 'seal' | 'delivery' | null = null;
  const sessions = new WeakMap<TransactionContext, Data>();
  const session = (context: TransactionContext) => { const value = sessions.get(context); if (!value) throw new Error('Inactive session'); return value; };
  class Transactions extends UnitOfWork {
    async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const context = { id: Symbol('test') }, draft = structuredClone(data); sessions.set(context, draft);
      try { const result = await work(context); data = draft; return structuredClone(result); }
      finally { sessions.delete(context); release(); }
    }
  }
  class Repository extends WorldRepository {
    async lockParty(_id: string, _context: TransactionContext) {}
    async activeWorld(partyId: string, context: TransactionContext) {
      return [...session(context).worlds.values()].find(record => record.state.partyId === partyId && record.state.status === 'active')?.state.id ?? null;
    }
    async load(worldId: string, context: TransactionContext, additionalMembers: WorldMember[] = []) {
      const stored = session(context).worlds.get(worldId); if (!stored) return null;
      const record = structuredClone(stored);
      await this.progress(additionalMembers, context);
      for (const gatherer of record.state.gatherers) gatherer.xp = session(context).progress.get(gatherer.characterId)!.xp;
      return record;
    }
    async progress(members: WorldMember[], context: TransactionContext) {
      return members.map(member => {
        const progress = session(context).progress;
        if (!progress.has(member.characterId)) progress.set(member.characterId, { playerId: member.playerId, characterId: member.characterId, xp: 0 });
        return { ...progress.get(member.characterId)! };
      });
    }
    async create(record: WorldRecord, context: TransactionContext) {
      const worlds = session(context).worlds;
      if (worlds.has(record.state.id)) return false;
      worlds.set(record.state.id, structuredClone(record)); return true;
    }
    async save(state: VoxelWorld, expectedRevision: number, context: TransactionContext) {
      const draft = session(context), record = draft.worlds.get(state.id)!;
      if (record.state.revision !== expectedRevision) return false;
      record.state = structuredClone(state);
      for (const gatherer of state.gatherers) draft.progress.set(gatherer.characterId, { playerId: gatherer.playerId, characterId: gatherer.characterId, xp: gatherer.xp });
      return true;
    }
    async receipt(worldId: string, playerId: string, operationId: string, context: TransactionContext) {
      return session(context).receipts.get(`${worldId}:${playerId}:${operationId}`) ?? null;
    }
    async finish(worldId: string, playerId: string, signature: string, result: WorldCommandResult, rolls: number[], context: TransactionContext) {
      if (failure === 'finish') { failure = null; throw new Error('Receipt persistence failed'); }
      session(context).receipts.set(`${worldId}:${playerId}:${result.operationId}`, structuredClone({ signature, result, rolls }));
    }
    async seal(manifests: WorldCargoManifest[], context: TransactionContext) {
      if (failure === 'seal') { failure = null; throw new Error('Manifest persistence failed'); }
      for (const manifest of manifests) session(context).manifests.set(manifest.id, structuredClone(manifest));
    }
    async manifests(worldId: string, playerId: string, characterId: string, context: TransactionContext) {
      return [...session(context).manifests.values()].filter(manifest => manifest.worldId === worldId && manifest.playerId === playerId && manifest.characterId === characterId);
    }
    async ready(_context: TransactionContext) {}
    async roster(record: WorldRecord, context: TransactionContext) {
      const stored = session(context).worlds.get(record.state.id)!;
      stored.members = structuredClone(record.members); stored.ownerPlayerId = record.ownerPlayerId;
      stored.ownerCharacterId = record.ownerCharacterId; stored.partyRevision = record.partyRevision; stored.ownerFence = record.ownerFence;
    }
    async lockDeliveries(_id: string, _context: TransactionContext) {}
    async lastDelivery(worldId: string, context: TransactionContext) {
      return Math.max(0, ...[...session(context).deliveries.values()].filter(entry => entry.worldId === worldId).map(entry => entry.sequence));
    }
    async delivery(worldId: string, sequence: number, context: TransactionContext) { return session(context).deliveries.get(`${worldId}:${sequence}`) ?? null; }
    async finishDelivery(worldId: string, sequence: number, id: string, signature: string, result: WorldDeliveryResult, context: TransactionContext) {
      if (failure === 'delivery') { failure = null; throw new Error('Delivery persistence failed'); }
      session(context).deliveries.set(`${worldId}:${sequence}`, structuredClone({ worldId, sequence, id, signature, result }));
    }
  }
  const transactions = new Transactions(), repository = new Repository(), service = new WorldService(transactions, repository);
  return { service, deliveries: new WorldDeliveryService(transactions, repository, service), inspect: () => structuredClone(data), failNext: (point: typeof failure) => { failure = point; } };
}
