import { Inject, Injectable } from '@nestjs/common';
import type { SocialPair, SocialRelationship } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { SocialRepository, SocialPlayer } from '../ports/social.repository';

@Injectable()
export class PostgresSocialRepository extends SocialRepository {
  constructor(@Inject(Database) private readonly database: Database) { super(); }
  async claim(playerId: string, operationId: string, signature: string, context: TransactionContext) {
    const tx = this.database.session(context);
    await tx.insertInto('social_operations').values({ player_id: playerId, operation_id: operationId, signature, result: null })
      .onConflict(conflict => conflict.columns(['player_id', 'operation_id']).doNothing()).execute();
    return tx.selectFrom('social_operations').select(['signature', 'result']).where('player_id', '=', playerId).where('operation_id', '=', operationId).forUpdate().executeTakeFirstOrThrow();
  }
  async lockPlayers(ids: string[], context: TransactionContext) {
    const tx = this.database.session(context), players: SocialPlayer[] = [];
    for (const id of [...new Set(ids)].sort()) {
      await tx.insertInto('social_players').values({ player_id: id, revision: 0, visibility_revision: 0 }).onConflict(conflict => conflict.column('player_id').doNothing()).execute();
      const row = await tx.selectFrom('social_players').selectAll().where('player_id', '=', id).forUpdate().executeTakeFirstOrThrow();
      players.push({ id: row.player_id, revision: row.revision, visibilityRevision: row.visibility_revision });
    }
    return players;
  }
  async pair(one: string, two: string, context?: TransactionContext) {
    const [low, high] = [one, two].sort();
    const row = await this.database.session(context).selectFrom('social_pairs').select('data').where('low_id', '=', low).where('high_id', '=', high).executeTakeFirst();
    return row?.data;
  }
  async pairs(playerId: string, context: TransactionContext) {
    return (await this.database.session(context).selectFrom('social_pairs').select('data').where(eb => eb.or([eb('low_id', '=', playerId), eb('high_id', '=', playerId)])).execute()).map(row => row.data);
  }
  async save(pair: SocialPair, players: SocialPlayer[], context: TransactionContext) {
    const tx = this.database.session(context);
    await tx.insertInto('social_pairs').values({ low_id: pair.lowId, high_id: pair.highId, data: JSON.stringify(pair) })
      .onConflict(conflict => conflict.columns(['low_id', 'high_id']).doUpdateSet({ data: JSON.stringify(pair) })).execute();
    for (const player of players) await tx.updateTable('social_players').set({ revision: player.revision, visibility_revision: player.visibilityRevision }).where('player_id', '=', player.id).execute();
  }
  async complete(playerId: string, operationId: string, result: SocialRelationship, context: TransactionContext) {
    await this.database.session(context).updateTable('social_operations').set({ result: JSON.stringify(result) }).where('player_id', '=', playerId).where('operation_id', '=', operationId).execute();
  }
}
