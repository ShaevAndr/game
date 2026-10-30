import type { EffectExpression } from '../effects/types';

/** All terms share a 10000 denominator; negative debuffs floor in the same way as attributes. */
export function evaluateEffectExpression(expression: EffectExpression, caster: Record<string, number>, target: Record<string, number>, rank: number): number {
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) throw new Error('Неверный уровень эффекта');
  let numerator = BigInt(expression.constant ?? 0) * 10000n;
  for (const term of expression.terms ?? []) {
    const value = (term.scope === 'caster' ? caster : target)[term.statId];
    if (!Number.isSafeInteger(value)) throw new Error(`Неизвестная характеристика выражения ${term.statId}`);
    const weight = term.weightBps + (rank - 1) * (term.weightPerRankBps ?? 0);
    numerator += BigInt(value) * BigInt(weight);
  }
  const min = expression.min ?? (expression.unit === 'turns' ? 1 : -1_000_000);
  const max = expression.max ?? (expression.unit === 'turns' ? 20 : 1_000_000);
  if (numerator <= BigInt(min) * 10000n) return min;
  if (numerator >= BigInt(max) * 10000n) return max;
  const result = numerator / 10000n;
  return Number(numerator < 0n && numerator % 10000n ? result - 1n : result);
}
