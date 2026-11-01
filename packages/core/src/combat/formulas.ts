import { z } from 'zod';
import type { Battle, Element, Fighter } from '../types';

const bps = z.number().int().min(0).max(10000);
export const combatFormulaRulesSchema = z.object({
  version: z.literal(1),
  armorK: z.number().int().min(1).max(100000), armorKPerLevel: z.number().int().min(0).max(1000),
  armorReductionCapBps: bps.max(9900),
  physicalMissMinBps: bps, physicalMissMaxBps: bps, physicalMissScaleBps: bps,
  luckAvoidMaxBps: bps.max(5000), luckDifferenceScale: z.number().int().min(1).max(10000),
}).strict().superRefine((rules, context) => {
  if (rules.physicalMissMinBps > rules.physicalMissMaxBps) context.addIssue({ code: 'custom', message: 'Минимальный шанс промаха превышает максимальный' });
});
export type CombatFormulaRules = z.infer<typeof combatFormulaRulesSchema>;
export const defaultCombatFormulaRules: CombatFormulaRules = {
  version: 1, armorK: 30, armorKPerLevel: 2, armorReductionCapBps: 9000,
  physicalMissMinBps: 100, physicalMissMaxBps: 500, physicalMissScaleBps: 1500,
  luckAvoidMaxBps: 1000, luckDifferenceScale: 100,
};
export interface DamageChances { hitChanceBps: number; luckAvoidChanceBps: number }
export interface DamageResolution extends DamageChances {
  sourceId: string; targetId: string; element: Element; skillId?: string; effectId?: string;
  outcome: 'hit' | 'miss' | 'luck_avoided' | 'zero'; critical: boolean;
  raw: number; armorReductionBps: number; amount: number; hpLoss: number;
}
export function damageChances(battle: Pick<Battle, 'content'>, actor: Fighter, target: Fighter, element: Element, canMiss = element === 'physical'): DamageChances {
  const rules = battle.content.balance.formulas;
  if (!rules) return { hitChanceBps: 10000, luckAvoidChanceBps: 0 };
  const accuracy = Math.max(0, actor.attributes?.effective.accuracy ?? 100);
  const evasion = Math.max(0, target.attributes?.effective.evasion ?? 0);
  const denominator = 2 * accuracy + evasion;
  const miss = canMiss ? Math.max(rules.physicalMissMinBps, Math.min(rules.physicalMissMaxBps,
    denominator > 0 ? Math.floor(evasion * rules.physicalMissScaleBps / denominator) : rules.physicalMissMinBps)) : 0;
  const difference = Math.max(0, (target.attributes?.effective.luck ?? 0) - (actor.attributes?.effective.luck ?? 0));
  return { hitChanceBps: 10000 - miss,
    luckAvoidChanceBps: Math.floor(rules.luckAvoidMaxBps * difference / (difference + rules.luckDifferenceScale)) };
}
