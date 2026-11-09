import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { VoxelWorld, WorldCargoManifest, WorldDeliveryResult } from '@game/core';
import { WorldDatabase } from '../../../infrastructure/database/world-database';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { canonicalJson } from '../../../shared/application/canonical-json';
import type { WorldCommandResult, WorldDefinition, WorldMember } from '../../../shared/application/world-contracts';
import { WorldRepository, type WorldRecord } from '../ports/world.repository';

const definition = (state: VoxelWorld): WorldDefinition => ({ generatorRevision: state.generatorRevision,
  seed: state.seed, rngState: state.rngState, settings: state.settings, catalog: state.catalog });

@Injectable()
export class PostgresWorldRepository extends WorldRepository {
  constructor(@Inject(WorldDatabase) private readonly db: WorldDatabase) { super(); }
  async lockParty(partyId: string, context: TransactionContext) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${'world-party:' + partyId}, 0))`.execute(this.db.session(context));
  }
  async activeWorld(partyId: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('instances').select('id').where('party_id', '=', partyId).where('status', '=', 'active').executeTakeFirst())?.id ?? null;
  }
  async load(worldId: string, context: TransactionContext, additionalMembers: WorldMember[] = []): Promise<WorldRecord | null> {
    const tx = this.db.session(context);
    const row = await tx.selectFrom('instances').selectAll().where('id', '=', worldId).forUpdate().executeTakeFirst();
    if (!row) return null;
    const members = await tx.selectFrom('members').selectAll().where('world_id', '=', worldId).orderBy('character_id').execute();
    if (additionalMembers.length) {
      const union = new Map(members.map(member => [member.character_id, { playerId: member.player_id, characterId: member.character_id, membershipId: member.membership_id }]));
      for (const member of additionalMembers) union.set(member.characterId, member);
      await this.progress([...union.values()], context);
    }
    const progress = await tx.selectFrom('progress').selectAll().where('character_id', 'in', members.map(member => member.character_id))
      .orderBy('character_id').forUpdate().execute();
    const geometry = await tx.selectFrom('geometry').select('data').where('world_id', '=', worldId).executeTakeFirst();
    if (row.status === 'active' && !geometry) throw new Error('Active world geometry is missing');
    const regions = await tx.selectFrom('regions').select('data').where('world_id', '=', worldId).orderBy('cell_id').execute();
    return {
      ownerPlayerId: row.owner_player_id, ownerCharacterId: row.owner_character_id, partyRevision: row.party_revision, ownerFence: row.owner_fence,
      members: members.filter(member => member.active).map(member => ({ playerId: member.player_id, characterId: member.character_id, membershipId: member.membership_id })),
      state: { ...row.data, id: row.id, partyId: row.party_id, revision: row.revision, status: row.status,
        map: geometry?.data.map ?? [], location: geometry?.data.location ?? null, regions: regions.map(region => region.data),
        gatherers: members.map(member => {
          const saved = progress.find(entry => entry.character_id === member.character_id);
          if (!saved || saved.player_id !== member.player_id) throw new Error('Gatherer progress ownership is inconsistent');
          return { playerId: member.player_id, characterId: member.character_id, xp: saved.xp, cargo: member.cargo };
        }),
      },
    };
  }
  async progress(members: WorldMember[], context: TransactionContext) {
    const tx = this.db.session(context);
    const sorted = [...members].sort((a, b) => a.characterId.localeCompare(b.characterId));
    for (const member of sorted) await tx.insertInto('progress').values({ character_id: member.characterId, player_id: member.playerId, xp: 0 })
      .onConflict(conflict => conflict.column('character_id').doNothing()).execute();
    return (await tx.selectFrom('progress').selectAll().where('character_id', 'in', sorted.map(member => member.characterId))
      .orderBy('character_id').forUpdate().execute()).map(row => ({ characterId: row.character_id, playerId: row.player_id, xp: row.xp }));
  }
  async create(record: WorldRecord, context: TransactionContext) {
    const tx = this.db.session(context), state = record.state;
    const inserted = await tx.insertInto('instances').values({ id: state.id, party_id: state.partyId,
      owner_player_id: record.ownerPlayerId, owner_character_id: record.ownerCharacterId,
      party_revision: record.partyRevision, owner_fence: record.ownerFence,
      revision: state.revision, status: state.status, data: JSON.stringify(definition(state)) })
      .onConflict(conflict => conflict.column('id').doNothing()).returning('id').executeTakeFirst();
    if (!inserted) return false;
    await tx.insertInto('geometry').values({ world_id: state.id, data: JSON.stringify({ map: state.map, location: state.location }) }).execute();
    for (const member of record.members) await tx.insertInto('members').values({ world_id: state.id,
      character_id: member.characterId, player_id: member.playerId, membership_id: member.membershipId, active: true, cargo: '[]' }).execute();
    return true;
  }
  async save(state: VoxelWorld, expectedRevision: number, context: TransactionContext) {
    const tx = this.db.session(context);
    const updated = await tx.updateTable('instances').set({ revision: state.revision, status: state.status, data: JSON.stringify(definition(state)) })
      .where('id', '=', state.id).where('revision', '=', expectedRevision).executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) return false;
    if (state.status === 'closed') {
      await tx.deleteFrom('regions').where('world_id', '=', state.id).execute();
      await tx.deleteFrom('geometry').where('world_id', '=', state.id).execute();
    } else {
      await tx.updateTable('geometry').set({ data: JSON.stringify({ map: state.map, location: state.location }) }).where('world_id', '=', state.id).execute();
      for (const region of state.regions) await tx.insertInto('regions').values({ world_id: state.id, cell_id: region.cellId, revision: region.revision, data: JSON.stringify(region) })
        .onConflict(conflict => conflict.columns(['world_id', 'cell_id']).doUpdateSet({ revision: region.revision, data: JSON.stringify(region) })
          .where('regions.revision', '<', region.revision)).execute();
    }
    for (const gatherer of state.gatherers) {
      await tx.updateTable('members').set({ cargo: JSON.stringify(gatherer.cargo) }).where('world_id', '=', state.id).where('character_id', '=', gatherer.characterId).execute();
      await tx.updateTable('progress').set({ xp: gatherer.xp }).where('character_id', '=', gatherer.characterId).where('player_id', '=', gatherer.playerId).execute();
    }
    return true;
  }
  async receipt(worldId: string, playerId: string, operationId: string, context: TransactionContext) {
    return await this.db.session(context).selectFrom('operations').select(['signature', 'result']).where('world_id', '=', worldId)
      .where('player_id', '=', playerId).where('operation_id', '=', operationId).executeTakeFirst() ?? null;
  }
  async finish(worldId: string, playerId: string, signature: string, result: WorldCommandResult, rolls: number[], context: TransactionContext) {
    await this.db.session(context).insertInto('operations').values({ world_id: worldId, player_id: playerId,
      operation_id: result.operationId, signature, result: JSON.stringify(result), rolls: JSON.stringify(rolls) }).execute();
  }
  async seal(manifests: WorldCargoManifest[], context: TransactionContext) {
    for (const manifest of manifests) {
      const data = canonicalJson(manifest);
      await this.db.session(context).insertInto('manifests').values({ id: manifest.id, world_id: manifest.worldId,
        player_id: manifest.playerId, character_id: manifest.characterId, data, hash: createHash('sha256').update(data).digest('hex') }).execute();
      const offer = { manifest, hash: createHash('sha256').update(data).digest('hex') };
      await this.db.session(context).insertInto('cargo_outbox').values({ manifest_id: manifest.id, data: JSON.stringify(offer), result: null }).execute();
    }
  }
  async manifests(worldId: string, playerId: string, characterId: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('manifests').select('data').where('world_id', '=', worldId)
      .where('player_id', '=', playerId).where('character_id', '=', characterId).orderBy('id').execute()).map(row => row.data);
  }
  async ready(context: TransactionContext) { await this.db.session(context).selectFrom('instances').select('id').limit(1).execute(); }
  async roster(record: WorldRecord, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.updateTable('instances').set({ owner_player_id: record.ownerPlayerId, owner_character_id: record.ownerCharacterId,
      party_revision: record.partyRevision, owner_fence: record.ownerFence }).where('id', '=', record.state.id).execute();
    await tx.updateTable('members').set({ active: false }).where('world_id', '=', record.state.id).execute();
    for (const member of record.members) {
      const cargo = JSON.stringify(record.state.gatherers.find(gatherer => gatherer.characterId === member.characterId)?.cargo ?? []);
      await tx.insertInto('members').values({ world_id: record.state.id, character_id: member.characterId,
        player_id: member.playerId, membership_id: member.membershipId, active: true, cargo })
        .onConflict(conflict => conflict.columns(['world_id', 'character_id']).doUpdateSet({ membership_id: member.membershipId, active: true, cargo })).execute();
    }
  }
  async lockDeliveries(worldId: string, context: TransactionContext) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${'world-delivery:' + worldId}, 0))`.execute(this.db.session(context));
  }
  async lastDelivery(worldId: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('deliveries').select('sequence').where('world_id', '=', worldId).orderBy('sequence', 'desc').limit(1).executeTakeFirst())?.sequence ?? 0;
  }
  async delivery(worldId: string, sequence: number, context: TransactionContext) {
    return await this.db.session(context).selectFrom('deliveries').select(['id', 'signature', 'result']).where('world_id', '=', worldId)
      .where('sequence', '=', sequence).executeTakeFirst() ?? null;
  }
  async finishDelivery(worldId: string, sequence: number, id: string, signature: string, result: WorldDeliveryResult, context: TransactionContext) {
    await this.db.session(context).insertInto('deliveries').values({ world_id: worldId, sequence, id, signature, result: JSON.stringify(result) }).execute();
  }
}
