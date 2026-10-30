import { z } from 'zod';
import { validateStatDefinitions } from './calculation';

export const statIdSchema = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,63}$/);
const integer = z.number().int().min(-1_000_000).max(1_000_000);
const display = {
  id: statIdSchema, name: z.string().min(1).max(80), description: z.string().max(500), displayOrder: z.number().int().min(0).max(10000),
  unit: z.enum(['points', 'hp', 'basis_points', 'points_per_cell']), min: integer, max: integer,
  group: statIdSchema, visible: z.boolean(), rounding: z.literal('floor'),
};
export const statDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({ ...display, kind: z.literal('primary'), defaultValue: integer, growthPerLevel: z.literal(0) }).strict(),
  z.object({ ...display, kind: z.literal('derived'), formula: z.object({ constant: integer.optional(), terms: z.array(z.object({ statId: statIdSchema, coefficientBps: z.number().int().min(-10_000_000).max(10_000_000) }).strict()).max(32) }).strict() }).strict(),
]);
export const statDefinitionsSchema = z.array(statDefinitionSchema).min(1).max(64).superRefine((definitions, context) => {
  try { validateStatDefinitions(definitions); }
  catch (error) { context.addIssue({ code: 'custom', message: (error as Error).message }); }
});
export const itemStatModifierSchema = z.object({
  statId: statIdSchema, operation: z.enum(['add_flat', 'add_percent', 'multiply', 'set']),
  value: z.number().int().min(-1_000_000).max(1_000_000), priority: integer.optional(),
}).strict();
export const itemScalingSchema = z.object({
  statId: statIdSchema, baseValue: z.number().int().min(0).max(1_000_000), scalingStatId: statIdSchema,
  coefficientBps: z.number().int().min(0).max(10_000_000),
}).strict();
