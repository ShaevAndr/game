import { Battle, Character, ChatMessage, ItemQuality, SkillEffect, CraftingResult, InventoryResult } from '@game/core';
import { ColumnType } from 'kysely';

export interface Tables {
  chat_streams: { id: string; stream_key: string; last_sequence: number };
  chat_messages: { id: string; sender_id: string; created_at: ColumnType<Date, Date, never>; data: ColumnType<ChatMessage, string, never> };
  chat_deliveries: { stream_id: string; sequence: number; message_id: string };
  chat_operations: { sender_id: string; operation_id: string; signature: string; result: ColumnType<ChatMessage | null, string | null, string> };
  accounts: { id: string; name: string; created_at: ColumnType<Date, Date, never> };
  account_sessions: { token_hash: string; account_id: string; character_id: string | null; expires_at: ColumnType<Date, Date, Date> };
  inventories: { id: string; owner_id: string; name: string; capacity: number; is_primary: boolean };
  item_instances: { effects: ColumnType<SkillEffect[] | null, string | null | undefined, string | null>; item_level: ColumnType<number, number | undefined, number>; definition_version: ColumnType<number, number | undefined, number>; quality: ColumnType<ItemQuality | null, string | null | undefined, string | null>; id: string; owner_id: string; inventory_id: string | null; item_id: string; quantity: number; equipped_slot: string | null };
  inventory_operations: { id: string; signature: string; result: ColumnType<InventoryResult | null, string | null, string> };
  crafting_operations: { id: string; signature: string; result: ColumnType<CraftingResult | null, string | null, string> };
  characters: { id: string; account_id: string; data: ColumnType<Character, string, string> };
  battles: { id: string; data: ColumnType<Battle, string, string>; version: number };
  battle_rewards: { battle_id: string; character_id: string; experience: number };
  battle_archive_outbox: {
    id: string;
    data: ColumnType<Battle, string, never>;
    delivered_at: ColumnType<Date | null, never, Date>;
  };
}
