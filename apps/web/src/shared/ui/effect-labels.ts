import type { EffectUnit, StatModifier } from '@game/core';

export function effectValue(operation: StatModifier['operation'], magnitude: number, unit: EffectUnit): string {
  if (operation === 'multiply') return `×${magnitude / 10000}`;
  const value = unit === 'basis_points' ? `${magnitude / 100}%` : String(magnitude);
  return operation === 'set' ? `= ${value}` : `${magnitude > 0 ? '+' : ''}${value}`;
}
export const targetingLabels: Record<string, string> = { self: 'На себя', ally_single: 'Союзник', enemy_single: 'Противник', allies_all: 'Все союзники', enemies_all: 'Все противники' };
