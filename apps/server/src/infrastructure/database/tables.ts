import { Battle, Character, ChatMessage, SocialPair, SocialRelationship, ItemQuality, SkillEffect, CraftingResult, InventoryResult } from '@game/core';
import { ColumnType } from 'kysely';
import type { GatheringReceipt, GatheringState } from '@game/core';
import type { Party, PartyCommandResult, PartyInvitation } from '@game/core';
import type { WorldDelivery, WorldDeliveryResult } from '@game/core';
import type { CargoOffer, CargoImportProof, CargoImportResult } from '@game/core';

export interface Tables {
  world_cargo_imports: { manifest_id: string; world_id: string; player_id: string; character_id: string;
    data: ColumnType<CargoOffer, string, never>; result: ColumnType<CargoImportResult | null, string | null, string> };
  world_cargo_operations: { player_id: string; operation_id: string; signature: string; result: ColumnType<CargoImportProof | null, string | null, string> };
  world_cargo_ack_outbox: { manifest_id: string; data: ColumnType<CargoImportProof, string, never>;
    delivered_at: ColumnType<Date | null, Date | null | undefined, Date>; failed: ColumnType<boolean, boolean | undefined, boolean>;
    retry_at: ColumnType<Date, Date | undefined, Date>; last_error: ColumnType<string | null, string | null | undefined, string | null> };
  inventory_world_reservations: { instance_id: string; owner_id: string; operation_id: string; world_id: string };
  world_journal_worlds: { world_id: string; party_id: string; state: 'active' | 'closing' | 'closed'; sequence: ColumnType<string | number, number, number> };
  world_journal_entries: { id: string; world_id: string; sequence: ColumnType<string | number, number, never>; player_id: string | null; operation_id: string | null;
    signature: string; data: ColumnType<WorldDelivery, string, never>; result: ColumnType<WorldDeliveryResult | null, string | null, string>;
    last_error: ColumnType<string | null, string | null | undefined, string | null> };
  parties: { id: string; data: ColumnType<Party, string, string> };
  party_members: { player_id: string; party_id: string; character_id: string };
  party_invitations: { id: string; party_id: string; inviter_id: string; target_id: string; status: string; expires_at: number; resolved_at: number | null; data: ColumnType<PartyInvitation, string, string> };
  party_operations: { player_id: string; operation_id: string; signature: string; result: ColumnType<PartyCommandResult | null, string | null, string> };
  gathering_states: { character_id: string; data: ColumnType<GatheringState, string, string> };
  gathering_operations: { character_id: string; operation_id: string; signature: string; result: ColumnType<GatheringReceipt | null, string | null, string> };
  social_players: { player_id: string; revision: number; visibility_revision: number };
  social_pairs: { low_id: string; high_id: string; data: ColumnType<SocialPair, string, string> };
  social_operations: { player_id: string; operation_id: string; signature: string; result: ColumnType<SocialRelationship | null, string | null, string> };
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
