import { z } from 'zod';
import type { Stats } from './types';
import { itemScalingSchema, itemStatModifierSchema, statIdSchema } from './attributes/schema';
import type { ScaledEquipmentBonus, StatModifier } from './attributes/types';

export const itemActionIds = ['split', 'merge', 'equip', 'unequip', 'use-in-battle', 'read'] as const;
export type ItemActionId = typeof itemActionIds[number];
export interface ItemGroup { id: string; name: string; description: string; actions: ItemActionId[] }
export interface ItemDefinition {
  id: string; name: string; description: string; groupId: string; stackLimit: number;
  heal?: number; equipSlot?: string; bonuses?: Partial<Stats>; grantedSkillId?: string;
  statModifiers?: Omit<StatModifier, 'id' | 'sourceId' | 'appliedSequence'>[];
  scaledBonuses?: Omit<ScaledEquipmentBonus, 'id' | 'sourceId'>[];
  attributeRequirements?: Record<string, number>;
}

export const defaultItemGroups: ItemGroup[] = [
  { id: 'weapons', name: 'Оружие', description: 'Предметы для боевых слотов.', actions: ['equip', 'unequip'] },
  { id: 'equipment', name: 'Экипировка', description: 'Броня и аксессуары.', actions: ['equip', 'unequip'] },
  { id: 'potions', name: 'Зелья', description: 'Расходуемые предметы для боя.', actions: ['use-in-battle', 'split', 'merge'] },
  { id: 'resources', name: 'Ресурсы', description: 'Материалы для производства.', actions: ['split', 'merge'] },
  { id: 'scrolls', name: 'Свитки', description: 'Одноразовые источники знаний.', actions: ['read', 'split', 'merge'] },
];
const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const itemGroupSchema = z.object({
  id: idSchema, name: z.string().min(1).max(80), description: z.string().max(500),
  actions: z.array(z.enum(itemActionIds)).max(20),
}).strict();
export const itemDefinitionSchema = z.object({
  id: idSchema, name: z.string().min(1).max(80), description: z.string().max(500),
  groupId: idSchema.default('potions'), stackLimit: z.number().int().min(1).max(9999).default(99),
  heal: z.number().int().positive().max(10000).optional(), equipSlot: idSchema.optional(),
  bonuses: z.object({ maxHp: z.number().int().min(0).max(10000), attack: z.number().int().min(0).max(10000), defense: z.number().int().min(0).max(10000), maxEnergy: z.number().int().min(0).max(10000) }).partial().optional(),
  grantedSkillId: idSchema.optional(),
  statModifiers: z.array(itemStatModifierSchema).max(32).optional(),
  scaledBonuses: z.array(itemScalingSchema).max(16).optional(),
  attributeRequirements: z.record(statIdSchema, z.number().int().min(0).max(1000)).optional(),
}).superRefine((item, ctx) => {
  if (item.equipSlot && item.stackLimit !== 1) ctx.addIssue({ code: 'custom', message: 'Экипируемый предмет не должен складываться в стэк' });
  if (item.bonuses && !item.equipSlot) ctx.addIssue({ code: 'custom', message: 'Бонусы требуют слот экипировки' });
  if ((item.statModifiers?.length || item.scaledBonuses?.length || Object.keys(item.attributeRequirements ?? {}).length) && !item.equipSlot) ctx.addIssue({ code: 'custom', message: 'Характеристики предмета требуют слот экипировки' });
});

export const itemActionNames: Record<ItemActionId, string> = {
  split: 'Разделить', merge: 'Объединить', equip: 'Экипировать', unequip: 'Снять', 'use-in-battle': 'Использовать в бою', read: 'Прочитать',
};

export function isBattleConsumable(item: Pick<ItemDefinition, 'groupId' | 'heal'>, groups?: ItemGroup[]) {
  return !!item.heal && (!groups || !!groups.find(group => group.id === item.groupId)?.actions.includes('use-in-battle'));
}
