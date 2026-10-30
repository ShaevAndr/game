import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InventoryResult, InventoryState, ItemQuality, ItemInstance, ItemStack } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { InventoryRepository } from '../ports/inventory.repository';

type ItemRow = { quality?: ItemQuality | null; id: string; owner_id: string; inventory_id: string | null; item_id: string; quantity: number; equipped_slot: string | null };
function instance(row: ItemRow): ItemInstance {
  return { ...(row.quality ? { quality: row.quality } : {}), id: row.id, ownerId: row.owner_id, inventoryId: row.inventory_id, itemId: row.item_id, quantity: row.quantity, equippedSlot: row.equipped_slot };
}

@Injectable()
export class PostgresInventoryRepository extends InventoryRepository {
  constructor(@Inject(Database) private readonly db: Database) { super(); }

  async ensurePrimary(ownerId: string, initial: ItemStack[], limits: Record<string, number>, context: TransactionContext) {
    const tx = this.db.session(context);
    const created = await tx.insertInto('inventories').values({ id: ownerId, owner_id: ownerId, name: 'Рюкзак', capacity: 50, is_primary: true })
      .onConflict(conflict => conflict.column('id').doNothing()).returning('id').executeTakeFirst();
    if (!created) return;
    const rows: ItemRow[] = [];
    for (const stack of initial) {
      const limit = limits[stack.itemId] ?? 99;
      for (let remaining = stack.quantity; remaining > 0;) {
        const quantity = Math.min(remaining, limit);
        rows.push({ id: randomUUID(), owner_id: ownerId, inventory_id: ownerId, item_id: stack.itemId, quantity, equipped_slot: null });
        remaining -= quantity;
      }
    }
    if (rows.length) await tx.insertInto('item_instances').values(rows.map(({ quality, ...row }) => row)).execute();
    if (rows.length > 50) await tx.updateTable('inventories').set({ capacity: rows.length }).where('id', '=', ownerId).execute();
  }

  async load(ownerId: string, context: TransactionContext): Promise<InventoryState> {
    const tx = this.db.session(context);
    const [inventories, items] = await Promise.all([
      tx.selectFrom('inventories').selectAll().where('owner_id', '=', ownerId).orderBy('is_primary', 'desc').orderBy('id').execute(),
      tx.selectFrom('item_instances').selectAll().where('owner_id', '=', ownerId).orderBy('id').execute(),
    ]);
    return { ownerId, inventories: inventories.map(row => ({ id: row.id, ownerId, name: row.name, capacity: row.capacity, primary: row.is_primary })), items: items.map(instance) };
  }

  async instance(id: string, context?: TransactionContext) {
    const row = await this.db.session(context).selectFrom('item_instances').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? instance(row) : undefined;
  }
  async inventoryOwner(id: string, context?: TransactionContext) { return (await this.db.session(context).selectFrom('inventories').select('owner_id').where('id', '=', id).executeTakeFirst())?.owner_id; }

  async save(states: InventoryState[], context: TransactionContext) {
    const tx = this.db.session(context);
    const items = states.flatMap(state => state.items);
    const ownerIds = states.map(state => state.ownerId);
    let remove = tx.deleteFrom('item_instances').where('owner_id', 'in', ownerIds);
    if (items.length) remove = remove.where('id', 'not in', items.map(item => item.id));
    await remove.execute();
    for (const inventory of states.flatMap(state => state.inventories)) {
      await tx.insertInto('inventories').values({ id: inventory.id, owner_id: inventory.ownerId, name: inventory.name, capacity: inventory.capacity, is_primary: inventory.primary })
        .onConflict(conflict => conflict.column('id').doUpdateSet({ name: inventory.name, capacity: inventory.capacity })).execute();
    }
    // Release previous equipment slots before filling them: the unique index is immediate.
    const ordered = [...items].sort((left, right) => Number(!!left.equippedSlot) - Number(!!right.equippedSlot));
    for (const item of ordered) {
      const row = { quality: item.quality ? JSON.stringify(item.quality) : null, id: item.id, owner_id: item.ownerId, inventory_id: item.inventoryId, item_id: item.itemId, quantity: item.quantity, equipped_slot: item.equippedSlot };
      await tx.insertInto('item_instances').values(row).onConflict(conflict => conflict.column('id').doUpdateSet(row)).execute();
    }
  }

  async claimOperation(id: string, signature: string, context: TransactionContext) {
    const tx = this.db.session(context);
    await tx.insertInto('inventory_operations').values({ id, signature, result: null }).onConflict(conflict => conflict.column('id').doNothing()).execute();
    return tx.selectFrom('inventory_operations').select(['signature', 'result']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
  }
  async finishOperation(id: string, result: InventoryResult, context: TransactionContext) {
    await this.db.session(context).updateTable('inventory_operations').set({ result: JSON.stringify(result) }).where('id', '=', id).execute();
  }
}
