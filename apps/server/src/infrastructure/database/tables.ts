import { Battle, Character, ItemQuality, CraftingResult, InventoryResult } from '@game/core';
import { ColumnType } from 'kysely';

export interface Tables {
  inventories: { id: string; owner_id: string; name: string; capacity: number; is_primary: boolean };
  item_instances: { quality: ColumnType<ItemQuality | null, string | null | undefined, string | null>; id: string; owner_id: string; inventory_id: string | null; item_id: string; quantity: number; equipped_slot: string | null };
  inventory_operations: { id: string; signature: string; result: ColumnType<InventoryResult | null, string | null, string> };
  crafting_operations: { id: string; signature: string; result: ColumnType<CraftingResult | null, string | null, string> };
  characters: { id: string; data: ColumnType<Character, string, string> };
  battles: { id: string; data: ColumnType<Battle, string, string>; version: number };
  battle_rewards: { battle_id: string; character_id: string; experience: number };
  battle_archive_outbox: {
    id: string;
    data: ColumnType<Battle, string, never>;
    delivered_at: ColumnType<Date | null, never, Date>;
  };
}
