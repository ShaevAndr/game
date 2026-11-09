import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CargoOffer, CargoImportProof, CargoImportResult } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { WorldCargoRepository } from '../ports/world-cargo.repository';
@Injectable()
export class PostgresWorldCargoRepository extends WorldCargoRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async register(offer: CargoOffer, context: TransactionContext) {
    await this.db.session(context).insertInto('world_cargo_imports').values({ manifest_id: offer.manifest.id, world_id: offer.manifest.worldId,
      player_id: offer.manifest.playerId, character_id: offer.manifest.characterId, data: JSON.stringify(offer), result: null })
      .onConflict(conflict => conflict.column('manifest_id').doNothing()).execute();
    return (await this.get(offer.manifest.id, context))!;
  }
  async get(manifestId: string, context: TransactionContext) {
    const row = await this.db.session(context).selectFrom('world_cargo_imports').select(['data', 'result']).where('manifest_id', '=', manifestId).forUpdate().executeTakeFirst();
    return row ? { offer: row.data, result: row.result } : null;
  }
  async list(playerId: string, characterId: string) {
    return (await this.db.sql.selectFrom('world_cargo_imports').select(['data', 'result']).where('player_id', '=', playerId)
      .where('character_id', '=', characterId).orderBy('manifest_id').execute()).map(row => ({ offer: row.data, result: row.result }));
  }
  async result(manifestId: string, result: CargoImportResult, context: TransactionContext) {
    await this.db.session(context).updateTable('world_cargo_imports').set({ result: JSON.stringify(result) }).where('manifest_id', '=', manifestId).execute();
  }
  async acknowledge(proof: CargoImportProof, context: TransactionContext) {
    await this.db.session(context).insertInto('world_cargo_ack_outbox').values({ manifest_id: proof.manifestId, data: JSON.stringify(proof) })
      .onConflict(conflict => conflict.column('manifest_id').doNothing()).execute();
  }
  async pending() {
    return (await this.db.sql.selectFrom('world_cargo_ack_outbox').select(['manifest_id', 'data']).where('delivered_at', 'is', null).where('failed', '=', false)
      .where('retry_at', '<=', new Date()).orderBy('retry_at').limit(16).execute()).map(row => ({ id: row.manifest_id, proof: row.data }));
  }
  async sent(id: string) { await this.db.sql.updateTable('world_cargo_ack_outbox').set({ delivered_at: new Date(), last_error: null }).where('manifest_id', '=', id).execute(); }
  async failure(id: string, error: string, permanent: boolean) {
    await this.db.sql.updateTable('world_cargo_ack_outbox').set({ last_error: error.slice(0, 1000), failed: permanent, retry_at: sql`now() + interval '10 seconds'` })
      .where('manifest_id', '=', id).where('delivered_at', 'is', null).execute();
  }
  async claim(playerId: string, operationId: string, signature: string, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.insertInto('world_cargo_operations').values({ player_id: playerId, operation_id: operationId, signature, result: null })
      .onConflict(conflict => conflict.columns(['player_id', 'operation_id']).doNothing()).execute();
    return tx.selectFrom('world_cargo_operations').select(['signature', 'result']).where('player_id', '=', playerId).where('operation_id', '=', operationId).forUpdate().executeTakeFirstOrThrow();
  }
  async finishClaim(playerId: string, operationId: string, result: CargoImportProof, context: TransactionContext) {
    await this.db.session(context).updateTable('world_cargo_operations').set({ result: JSON.stringify(result) }).where('player_id', '=', playerId).where('operation_id', '=', operationId).execute();
  }
}
