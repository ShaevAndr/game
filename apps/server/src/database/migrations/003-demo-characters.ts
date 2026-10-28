import { Migration, sql } from 'kysely';
import characters from './003-demo-characters.json';

// Keep this snapshot independent of future balance and seedContent changes.
export const demoCharactersMigration: Migration = {
  async up(db) {
    for (const character of characters) {
      await sql`INSERT INTO characters (id, data)
        VALUES (${character.id}::uuid, ${JSON.stringify(character)}::jsonb)
        ON CONFLICT (id) DO NOTHING`.execute(db);
    }
  },
};
