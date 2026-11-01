import type { Battle, Element, Fighter } from '../types';
import type { Rational } from '../attributes/rational';
import { damageChances, type DamageResolution } from './formulas';
import { battleRandomBps } from './random';
import { addLog } from './log';

const succeeds = (battle: Battle, chance: number) => chance >= 10000 || chance > 0 && battleRandomBps(battle) < chance;

/** One authoritative pipeline for simple and composed attacks. Only the snapshot's rules are used. */
export function resolveDamage(battle: Battle, actor: Fighter, target: Fighter, raw: Rational, element: Element,
  canCrit: boolean, context: { skillId?: string; effectId?: string; canMiss?: boolean } = {}): number {
  const rules = battle.content.balance.formulas;
  if (!rules) throw new Error('Не настроен профиль расчёта урона');
  const result: DamageResolution = { ...damageChances(battle, actor, target, element, context.canMiss),
    ...(context.skillId ? { skillId: context.skillId } : {}), ...(context.effectId ? { effectId: context.effectId } : {}),
    sourceId: actor.id, targetId: target.id, element, outcome: 'zero', critical: false,
    raw: Number(raw.numerator) / Number(raw.denominator), armorReductionBps: 0, amount: 0, hpLoss: 0 };
  if (raw.numerator > 0n && target.hp > 0) {
    if (!succeeds(battle, result.hitChanceBps)) result.outcome = 'miss';
    else if (succeeds(battle, result.luckAvoidChanceBps)) result.outcome = 'luck_avoided';
    else {
      result.outcome = 'hit';
      result.critical = canCrit && succeeds(battle, actor.attributes?.effective.criticalChanceBps ?? 0);
      const bonus = result.critical ? actor.attributes?.effective.criticalBonusBps ?? 0 : 0;
      const defense = Math.max(0, (target.attributes?.effective[element === 'physical' ? 'physicalResistance' : `${element}Resistance`] ?? target.stats.defense) + (target.guardDefense ?? 0));
      const k = rules.armorK + rules.armorKPerLevel * ((actor.combatLevel ?? 1) - 1);
      const capped = BigInt(defense) * 10000n > BigInt(rules.armorReductionCapBps) * BigInt(k + defense);
      const remainingNumerator = BigInt(capped ? 10000 - rules.armorReductionCapBps : k);
      const remainingDenominator = BigInt(capped ? 10000 : k + defense);
      result.armorReductionBps = capped ? rules.armorReductionCapBps : Number(BigInt(defense) * 10000n / BigInt(k + defense));
      const numerator = raw.numerator * BigInt(10000 + bonus) * remainingNumerator;
      const denominator = raw.denominator * 10000n * remainingDenominator;
      // Preserve the existing physical flat bonus as a separate, non-critical addition.
      const flat = element === 'physical' ? actor.attributes?.effective.physicalDamageFlat ?? 0 : 0;
      result.amount = Math.max(1, Number(numerator / denominator) + flat);
      result.hpLoss = Math.min(target.hp, result.amount);
      target.hp -= result.hpLoss;
    }
  }
  (battle.damageResults ??= []).push(result);
  if (result.outcome === 'miss') addLog(battle, `${actor.name} → ${target.name}: физический удар не попал (промах/уклонение)`);
  else if (result.outcome === 'luck_avoided') addLog(battle, `${actor.name} → ${target.name}: удачная случайность предотвратила урон`);
  else addLog(battle, `${actor.name} → ${target.name}: ${result.hpLoss} урона (${element}${result.critical ? ', критический' : ''})`);
  return result.hpLoss;
}
