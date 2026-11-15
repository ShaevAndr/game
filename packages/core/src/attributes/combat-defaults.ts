import { defaultStatDefinitions } from './defaults';
import type { StatDefinition } from './types';

/** A versioned catalog seed. Existing battle snapshots keep their own definitions. */
export const combatStatDefinitions: StatDefinition[] = structuredClone(defaultStatDefinitions);
for (const definition of combatStatDefinitions) {
  if (definition.kind === 'primary') {
    if (definition.id === 'luck') definition.description = 'Магический крит, вклад в физический крит и шанс избежать урона при преимуществе удачи.';
    if (definition.id === 'dexterity') definition.description = 'Уклонение, физический крит, точность оружия и в меньшей мере магии; требования ловкого оружия.';
    continue;
  }
  if (definition.id === 'maxHp') definition.formula = { constant: 180, perLevel: 6, terms: [{ statId: 'vitality', coefficientBps: 60000 }] };
  // Linear growth keeps equal-budget HP and attack on the same scale at higher levels.
  if (definition.id === 'physicalPower' || definition.id === 'magicPower') definition.formula = {
    constant: definition.id === 'physicalPower' ? 1 : 2, perLevel: 1,
    terms: definition.id === 'physicalPower'
      ? [{ statId: 'strength', coefficientBps: 6000 }, { statId: 'dexterity', coefficientBps: 1000 }]
      : [{ statId: 'intelligence', coefficientBps: 6000 }],
  };
  if (definition.id === 'criticalBonusBps') definition.formula = { constant: 5000, terms: [] };
  if (definition.id === 'physicalResistance' || ['fireResistance', 'waterResistance', 'earthResistance', 'airResistance'].includes(definition.id)) definition.formula = {
    terms: [{ statId: 'vitality', coefficientBps: 3000 }],
    factor: { constantBps: 10000, includeEquipment: true, terms: [{ statId: 'vitality', coefficientBps: 20 }] },
  };
}
