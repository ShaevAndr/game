import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../../infrastructure/database/database.service';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { InventoryReservationsRepository, type InventoryWorldReservation } from '../ports/inventory-reservations.repository';
@Injectable()
export class PostgresInventoryReservationsRepository extends InventoryReservationsRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }
  async forOwner(ownerId: string, context: TransactionContext) {
    return (await this.db.session(context).selectFrom('inventory_world_reservations').selectAll().where('owner_id', '=', ownerId).execute())
      .map(row => ({ instanceId: row.instance_id, ownerId: row.owner_id, operationId: row.operation_id, worldId: row.world_id }));
  }
  async reserve(value: InventoryWorldReservation, context: TransactionContext) {
    return !!await this.db.session(context).insertInto('inventory_world_reservations').values({ instance_id: value.instanceId,
      owner_id: value.ownerId, operation_id: value.operationId, world_id: value.worldId })
      .onConflict(conflict => conflict.doNothing()).returning('instance_id').executeTakeFirst();
  }
  async release(operationId: string, ownerId: string, context: TransactionContext) {
    await this.db.session(context).deleteFrom('inventory_world_reservations').where('operation_id', '=', operationId).where('owner_id', '=', ownerId).execute();
  }
}
