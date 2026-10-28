import { Migration, sql } from 'kysely';

/** Preserve learned skills/items while upgrading the old two-point starting allowance. */
export const matchedCombatMigration: Migration = {
  async up(db) {
    await sql`UPDATE characters SET data = jsonb_set(
      jsonb_set(
        jsonb_set(data, '{skillPoints}', to_jsonb(COALESCE((data->>'skillPoints')::int + 2, 4 + (GREATEST(COALESCE((data->>'level')::int, 1), 1) - 1) * 2))),
        '{stats,maxEnergy}', '30'::jsonb),
      '{energy}', jsonb_build_object(
        'fire', LEAST(30, GREATEST(0, COALESCE((data->'energy'->>'fire')::int, 0))),
        'water', LEAST(30, GREATEST(0, COALESCE((data->'energy'->>'water')::int, 0))),
        'earth', LEAST(30, GREATEST(0, COALESCE((data->'energy'->>'earth')::int, 0))),
        'air', LEAST(30, GREATEST(0, COALESCE((data->'energy'->>'air')::int, 0))),
        'physical', LEAST(30, GREATEST(0, COALESCE((data->'energy'->>'physical')::int, 0))),
        'defense', LEAST(30, GREATEST(0, COALESCE((data->'energy'->>'defense')::int, 0)))))`.execute(db);
  },
};
