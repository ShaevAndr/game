import { Battle, Character } from '@game/core';
import { ColumnType } from 'kysely';

export interface Tables {
  characters: { id: string; data: ColumnType<Character, string, string> };
  battles: { id: string; data: ColumnType<Battle, string, string>; version: number };
  battle_rewards: { battle_id: string; character_id: string; experience: number };
  battle_archive_outbox: {
    id: string;
    data: ColumnType<Battle, string, never>;
    delivered_at: ColumnType<Date | null, never, Date>;
  };
}
