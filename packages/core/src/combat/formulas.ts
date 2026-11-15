import { z } from 'zod';
import type { Battle, Element, Fighter } from '../types';

const bps = z.number().int().min(0).max(10000);
export const combatFormulaRulesSchema = z.object({
  version: z.literal(1),
  armorK: z.number().int().min(1).max(100000), armorKPerLevel: z.number().int().min(0).max(1000),
  armorReductionCapBps: bps.max(9900),
  physicalMissMinBps: bps, physicalMissMaxBps: bps, physicalMissScaleBps: bps,
  magicMissMinBps: bps, magicMissMaxBps: bps, magicMissScaleBps: bps,
  luckAvoidMaxBps: bps.max(5000), luckDifferenceScale: z.number().int().min(1).max(10000),
}).strict().superRefine((rules, context) => {
  if (rules.physicalMissMinBps > rules.physicalMissMaxBps) context.addIssue({ code: 'custom', message: 'Минимальный шанс промаха превышает максимальный' });
  if (rules.magicMissMinBps > rules.magicMissMaxBps) context.addIssue({ code: 'custom', message: 'Минимальный магический промах превышает максимальный' });
});
export type CombatFormulaRules = z.infer<typeof combatFormulaRulesSchema>;
export const defaultCombatFormulaRules: CombatFormulaRules = {
  version: 1, armorK: 30, armorKPerLevel: 2, armorReductionCapBps: 9000,
  physicalMissMinBps: 100, physicalMissMaxBps: 3500, physicalMissScaleBps: 10000,
  magicMissMinBps: 50, magicMissMaxBps: 2000, magicMissScaleBps: 4000,
  luckAvoidMaxBps: 1000, luckDifferenceScale: 100,
};
export interface DamageChances { hitChanceBps: number; luckAvoidChanceBps: number; criticalChanceBps: number }
export interface DamageResolution extends DamageChances {
  sourceId: string; targetId: string; element: Element; skillId?: string; effectId?: string;
  outcome: 'hit' | 'miss' | 'luck_avoided' | 'zero'; critical: boolean;
  raw: number; armorReductionBps: number; amount: number; absorbed: number; hpLoss: number;
  periodic?: boolean;
}
export type AccuracyType = 'physical' | 'magic' | 'guaranteed';
export function criticalChanceBps(actor: Fighter, element: Element): number {
  return actor.attributes?.effective[element === 'physical' ? 'physicalCriticalChanceBps' : 'criticalChanceBps'] ?? 0;
}
export function damageChances(battle: Pick<Battle, 'content'>, actor: Fighter, target: Fighter, element: Element, accuracyType: AccuracyType = element === 'physical' ? 'physical' : 'magic'): DamageChances {
  const rules = battle.content.balance.formulas;
  const critical = criticalChanceBps(actor, element);
  if (!rules) return { hitChanceBps: 10000, luckAvoidChanceBps: 0, criticalChanceBps: critical };
  const physical = accuracyType === 'physical';
  const accuracy = Math.max(0, actor.attributes?.effective[physical ? 'accuracy' : 'magicAccuracy'] ?? (physical ? 100 : 150));
  const evasion = Math.max(0, target.attributes?.effective.evasion ?? 0);
  const denominator = 2 * accuracy + evasion;
  const min = physical ? rules.physicalMissMinBps : rules.magicMissMinBps;
  const max = physical ? rules.physicalMissMaxBps : rules.magicMissMaxBps;
  const scale = physical ? rules.physicalMissScaleBps : rules.magicMissScaleBps;
  const miss = accuracyType === 'guaranteed' ? 0 : Math.max(min, Math.min(max,
    denominator > 0 ? Math.floor(evasion * scale / denominator) : min));
  const difference = Math.max(0, (target.attributes?.effective.luck ?? 0) - (actor.attributes?.effective.luck ?? 0));
  return { hitChanceBps: 10000 - miss, criticalChanceBps: critical,
    luckAvoidChanceBps: Math.floor(rules.luckAvoidMaxBps * difference / (difference + rules.luckDifferenceScale)) };
}
