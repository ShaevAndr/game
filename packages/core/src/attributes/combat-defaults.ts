import { defaultStatDefinitions } from './defaults';
import type { StatDefinition } from './types';

/** A versioned catalog seed. Existing battle snapshots keep their own definitions. */
export const combatStatDefinitions: StatDefinition[] = structuredClone(defaultStatDefinitions);
for (const definition of combatStatDefinitions) {
  if (definition.kind === 'primary') {
    if (definition.id === 'luck') definition.description = 'Шанс крита и шанс избежать урона при преимуществе удачи над противником.';
    if (definition.id === 'dexterity') definition.description = 'Точность, уклонение и масштабирование ловкого оружия.';
    continue;
  }
  if (definition.id === 'maxHp') definition.formula = { constant: 60, perLevel: 6, terms: [{ statId: 'vitality', coefficientBps: 60000 }] };
  if (definition.id === 'physicalPower' || definition.id === 'magicPower') definition.formula = {
    constant: definition.id === 'physicalPower' ? 4 : 5, perLevel: 1,
    terms: definition.id === 'physicalPower' ? [{ statId: 'dexterity', coefficientBps: 1000 }] : [], factor: { constantBps: 10000,
      terms: [{ statId: definition.id === 'physicalPower' ? 'strength' : 'intelligence', coefficientBps: 600 }] },
  };
  if (definition.id === 'criticalBonusBps') definition.formula = { constant: 5000, terms: [] };
  if (definition.id === 'physicalResistance') definition.formula = { terms: [{ statId: 'vitality', coefficientBps: 2000 }, { statId: 'strength', coefficientBps: 1000 }],
    factor: { constantBps: 10000, includeEquipment: true, terms: [{ statId: 'vitality', coefficientBps: 8 }, { statId: 'strength', coefficientBps: 12 }] } };
  if (['fireResistance', 'waterResistance', 'earthResistance', 'airResistance'].includes(definition.id)) definition.formula.factor = {
    constantBps: 10000, includeEquipment: true, terms: [{ statId: 'vitality', coefficientBps: 8 }, { statId: 'intelligence', coefficientBps: 12 }],
  };
}
for (const [id, name, constant, coefficient, order] of [
  ['accuracy', 'Точность', 100, 20000, 15], ['evasion', 'Уклонение', 0, 20000, 16],
] as const) combatStatDefinitions.push({ id, name, description: name, displayOrder: order, kind: 'derived', unit: 'points', min: 0, max: 1_000_000,
  group: 'combat', visible: true, rounding: 'floor', formula: { constant, terms: [{ statId: 'dexterity', coefficientBps: coefficient }] } });
