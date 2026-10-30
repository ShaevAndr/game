import { z } from 'zod';
import { elements } from '../battlefield/types';
import { statIdSchema } from '../attributes/schema';
import type { StatDefinition } from '../attributes/types';
import type { SkillEffect, SkillTargeting } from './types';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const integer = z.number().int().min(-1_000_000).max(1_000_000);
export const effectExpressionSchema = z.object({
  unit: z.enum(['points', 'hp', 'basis_points', 'points_per_cell', 'turns']), constant: integer.optional(),
  terms: z.array(z.object({ scope: z.enum(['caster', 'target']), statId: statIdSchema,
    weightBps: z.number().int().min(-10_000_000).max(10_000_000), weightPerRankBps: z.number().int().min(-10_000_000).max(10_000_000).optional() }).strict()).max(32).optional(),
  min: integer.optional(), max: integer.optional(),
}).strict().superRefine((expression, context) => {
  if (expression.constant === undefined && !expression.terms?.length) context.addIssue({ code: 'custom', message: 'Пустое выражение эффекта' });
  if ((expression.min ?? (expression.unit === 'turns' ? 1 : -1_000_000)) > (expression.max ?? (expression.unit === 'turns' ? 20 : 1_000_000))) context.addIssue({ code: 'custom', message: 'Неверные границы выражения' });
  if (expression.unit === 'turns' && ((expression.min ?? 1) < 1 || (expression.max ?? 20) > 20)) context.addIssue({ code: 'custom', message: 'Длительность должна быть от 1 до 20 ходов' });
});
export const targetingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }).strict(), z.object({ kind: z.literal('enemy_single') }).strict(), z.object({ kind: z.literal('enemies_all') }).strict(),
  z.object({ kind: z.literal('ally_single'), includeSelf: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('allies_all'), includeSelf: z.boolean().optional() }).strict(),
]);
const base = { id, name: z.string().min(1).max(80).optional(), recipient: z.enum(['selected', 'caster']) };
export const skillEffectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('stat_modifier'), polarity: z.enum(['buff', 'debuff', 'neutral']), statId: statIdSchema,
    operation: z.enum(['add_flat', 'add_percent', 'multiply', 'set']), magnitude: effectExpressionSchema,
    durationTurns: z.union([z.number().int().min(1).max(20), effectExpressionSchema]), tags: z.array(id).max(16).optional(), dispellable: z.boolean().optional(),
    stackKey: id.optional(), stacking: z.enum(['refresh', 'replace_if_stronger', 'stack', 'independent']).optional(), maxStacks: z.number().int().min(1).max(20).optional(), priority: integer.optional(),
  }).strict(),
  z.object({ ...base, kind: z.literal('dispel'), polarityToRemove: z.enum(['buff', 'debuff']), maxCount: z.number().int().min(1).max(64), tags: z.array(id).max(16).optional() }).strict(),
  z.object({ ...base, kind: z.literal('damage'), magnitude: effectExpressionSchema, damageType: z.enum(elements), canCrit: z.boolean().optional() }).strict(),
  z.object({ ...base, kind: z.literal('heal'), magnitude: effectExpressionSchema }).strict(),
]);

export function validateSkillEffects(skills: { id: string; targeting?: SkillTargeting; effects?: SkillEffect[] }[], definitions: StatDefinition[]): void {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const groups = new Map<string, string>();
  for (const skill of skills) {
    if (!skill.effects?.length) { if (skill.targeting) throw new Error(`У навыка ${skill.id} нет эффектов`); continue; }
    if (!skill.targeting) throw new Error(`Не задана цель навыка ${skill.id}`);
    const ids = new Set<string>();
    for (const effect of skill.effects) {
      if (ids.has(effect.id)) throw new Error(`Дубликат эффекта ${skill.id}:${effect.id}`);
      ids.add(effect.id);
      if (effect.kind === 'dispel') continue;
      const expressions = [effect.magnitude, ...(effect.kind === 'stat_modifier' && typeof effect.durationTurns !== 'number' ? [effect.durationTurns] : [])];
      for (const expression of expressions) for (const term of expression.terms ?? []) if (!byId.has(term.statId)) throw new Error(`Неизвестная характеристика эффекта ${term.statId}`);
      if (effect.kind !== 'stat_modifier') {
        if (effect.magnitude.unit !== 'hp' || !effect.magnitude.terms?.length || (effect.magnitude.min ?? -1) < 0) throw new Error(`Урон и лечение ${skill.id} требуют неотрицательной формулы HP от характеристик`);
        continue;
      }
      const definition = byId.get(effect.statId);
      if (!definition) throw new Error(`Неизвестная характеристика эффекта ${effect.statId}`);
      const unit = effect.operation === 'add_percent' || effect.operation === 'multiply' ? 'basis_points' : definition.unit;
      if (effect.magnitude.unit !== unit) throw new Error(`Несовместимая единица эффекта ${skill.id}:${effect.id}`);
      if (typeof effect.durationTurns !== 'number' && effect.durationTurns.unit !== 'turns') throw new Error('Формула длительности требует единицу turns');
      if (effect.operation === 'multiply' && ((effect.magnitude.constant ?? 0) < 0 || (effect.magnitude.min ?? 0) < 0 || effect.magnitude.terms?.some(term => term.weightBps < 0 || (term.weightPerRankBps ?? 0) < 0))) throw new Error('Отрицательный множитель эффекта');
      if (['stack', 'replace_if_stronger'].includes(effect.stacking ?? '') && !['add_flat', 'add_percent'].includes(effect.operation)) throw new Error('Складывать и сравнивать силу можно только аддитивных модификаторов');
      if (effect.stackKey) {
        const signature = JSON.stringify([effect.statId, effect.operation, unit, effect.polarity, effect.stacking ?? 'refresh', effect.maxStacks ?? 3]);
        if (groups.has(effect.stackKey) && groups.get(effect.stackKey) !== signature) throw new Error(`Несовместимая группа эффектов ${effect.stackKey}`);
        groups.set(effect.stackKey, signature);
      }
    }
  }
}
