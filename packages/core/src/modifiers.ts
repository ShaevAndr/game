import { z } from 'zod';
import type { StatModifier } from './attributes/types';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const bps = z.number().int().min(0).max(10000);
export const modifierPermissionFields = ['allowWeapon', 'allowArmor', 'allowSkill', 'allowPotion', 'allowBuff', 'allowDebuff', 'allowGem'] as const;
export type ModifierPermission = typeof modifierPermissionFields[number];
export const itemScalingProfileSchema = z.object({
  id, version: z.number().int().min(1),
  baseBps: z.number().int().min(0).max(1_000_000),
  perLevelBps: z.number().int().min(0).max(1_000_000),
  maxBps: z.number().int().min(0).max(1_000_000),
}).strict().refine(value => value.baseBps <= value.maxBps, 'Неверные границы масштабирования');
export type ItemScalingProfile = z.infer<typeof itemScalingProfileSchema>;
export const defaultItemScalingProfiles: ItemScalingProfile[] = [
  { id: 'flat-stat', version: 1, baseBps: 10000, perLevelBps: 1000, maxBps: 100000 },
  { id: 'percentage', version: 1, baseBps: 10000, perLevelBps: 100, maxBps: 20000 },
  { id: 'fixed', version: 1, baseBps: 10000, perLevelBps: 0, maxBps: 10000 },
];
export const modifierDefinitionSchema = z.object({
  id, version: z.number().int().min(1), name: z.string().min(1).max(80), statId: z.string().min(1).max(64),
  operation: z.enum(['add_flat', 'add_percent', 'multiply', 'set']),
  allowSkill: z.boolean(), allowWeapon: z.boolean(), allowArmor: z.boolean(),
  allowPotion: z.boolean().optional(), allowBuff: z.boolean().optional(), allowDebuff: z.boolean().optional(), allowGem: z.boolean().optional(),
  formatVersion: z.literal(1).optional(), baseValue: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  itemRoll: z.object({ minFactorBps: z.number().int().min(0).max(100000), maxFactorBps: z.number().int().min(0).max(100000), scalingProfileId: id }).strict().optional(),
  craftWeight: z.number().int().min(0).max(1_000_000).optional(), activationChanceBps: bps.optional(),
  // Read-only compatibility with old saved content and administrator definitions.
  minValue: z.number().int().min(0).max(10000).optional(), maxValue: z.number().int().min(0).max(10000).optional(),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.formatVersion === 1) {
    if (value.baseValue === undefined || value.craftWeight === undefined || value.activationChanceBps === undefined || modifierPermissionFields.some(field => typeof value[field] !== 'boolean')) fail('Неполное определение допа v1');
    if ((value.craftWeight ?? 0) > 0 && !value.itemRoll) fail('Крафтовый доп требует диапазон');
    if (value.operation === 'multiply' && (value.baseValue ?? 0) < 0) fail('Отрицательный множитель допа');
  } else if (value.minValue === undefined || value.maxValue === undefined || value.minValue > value.maxValue) fail('Неверный диапазон величин допа');
  if (value.itemRoll && value.itemRoll.minFactorBps > value.itemRoll.maxFactorBps) fail('Неверный диапазон множителей допа');
});
export type ModifierDefinition = z.infer<typeof modifierDefinitionSchema>;
export function modifierAllowed(definition: ModifierDefinition, permission: ModifierPermission): boolean {
  const value = definition[permission];
  // Permission defaults apply only to definitions without an explicit format.
  return value ?? (definition.formatVersion !== 1 && (permission === 'allowBuff' || permission === 'allowDebuff') && definition.allowSkill);
}
export function rollBelow(roll: (max: number) => number, max: number): number {
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('Некорректная граница генератора');
  const value = roll(max);
  if (!Number.isInteger(value) || value < 0 || value >= max) throw new Error('Некорректный результат генератора случайности');
  return value;
}
export function itemModifierRange(definition: ModifierDefinition, itemLevel: number, profiles: ItemScalingProfile[]) {
  if (!Number.isInteger(itemLevel) || itemLevel < 1 || itemLevel > 1000) throw new Error('Неверный уровень предмета');
  if (definition.formatVersion !== 1) return { minValue: definition.minValue!, maxValue: definition.maxValue! };
  if (!definition.itemRoll || definition.baseValue === undefined) throw new Error('Доп не имеет диапазона генерации');
  const profile = profiles.find(value => value.id === definition.itemRoll!.scalingProfileId);
  if (!profile) throw new Error('Профиль силы предмета не найден');
  const scaling = Math.min(profile.maxBps, profile.baseBps + (itemLevel - 1) * profile.perLevelBps);
  const neutral = definition.operation === 'multiply' ? 10000n : 0n;
  const floor = (factor: number) => {
    const numerator = neutral * 100_000_000n + (BigInt(definition.baseValue!) - neutral) * BigInt(scaling) * BigInt(factor);
    const result = numerator / 100_000_000n;
    return Number(numerator < 0n && numerator % 100_000_000n ? result - 1n : result);
  };
  const a = floor(definition.itemRoll.minFactorBps), b = floor(definition.itemRoll.maxFactorBps);
  const minValue = Math.min(a, b), maxValue = Math.max(a, b);
  if (Math.abs(minValue) > 1_000_000 || Math.abs(maxValue) > 1_000_000 || definition.operation === 'multiply' && minValue < 0) throw new Error('Диапазон допа вне допустимых границ');
  return { minValue, maxValue, profileId: profile.id, profileVersion: profile.version };
}
export interface ActivationPolicy { activationChanceBps?: number; chancePerSkillRankBps?: number; maxChanceBps?: number }
export function activationChance(policy: ActivationPolicy, rank: number, baseChance = 10000): number {
  return Math.max(0, Math.min(policy.maxChanceBps ?? 10000, (policy.activationChanceBps ?? baseChance) + (rank - 1) * (policy.chancePerSkillRankBps ?? 0)));
}
export function modifierBaseNumerator(definition: ModifierDefinition, operation: StatModifier['operation'], coefficientBps: number): bigint {
  if (definition.baseValue === undefined) throw new Error('У допа нет опорной величины');
  const neutral = operation === 'multiply' ? 10000n : 0n;
  return neutral * 10000n + (BigInt(definition.baseValue) - neutral) * BigInt(coefficientBps);
}
