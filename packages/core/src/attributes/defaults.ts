import type { StatDefinition } from './types';

const primary = (id: string, name: string, description: string, displayOrder: number): StatDefinition => ({
  id, name, description, displayOrder, kind: 'primary', unit: 'points', min: 0, max: 1000,
  group: 'primary', visible: true, rounding: 'floor', defaultValue: 10, growthPerLevel: 0,
});
const derived = (id: string, name: string, unit: StatDefinition['unit'], terms: [string, number][], displayOrder: number, min = 0, max = 1_000_000): StatDefinition => ({
  id, name, description: name, displayOrder, kind: 'derived', unit, min, max,
  group: id.endsWith('Resistance') ? 'resistance' : 'combat', visible: true, rounding: 'floor',
  formula: { terms: terms.map(([statId, coefficientBps]) => ({ statId, coefficientBps })) },
});

export const defaultStatDefinitions: StatDefinition[] = [
  primary('strength', 'Сила', 'Физическая мощь и эффективность оружия.', 0),
  primary('dexterity', 'Ловкость', 'Физическая мощь и защита от физических атак.', 1),
  primary('intelligence', 'Интеллект', 'Магическая мощь, лечение и сопротивления стихиям.', 2),
  primary('vitality', 'Выносливость', 'Максимум здоровья, защита и стойкость.', 3),
  primary('luck', 'Удача', 'Шанс и дополнительная сила критического урона.', 4),
  derived('maxHp', 'Максимум здоровья', 'hp', [['vitality', 120000]], 10, 1),
  derived('physicalPower', 'Физическая мощь', 'points', [['strength', 6000], ['dexterity', 2000]], 11),
  derived('physicalDamageFlat', 'Прибавка к физическому урону', 'points', [], 14),
  derived('magicPower', 'Магическая мощь', 'points', [['intelligence', 8000]], 12),
  derived('healingPower', 'Сила лечения', 'points', [['intelligence', 6000], ['vitality', 2000]], 13),
  derived('physicalResistance', 'Физическая защита', 'points', [['vitality', 2000], ['dexterity', 1000]], 20),
  ...['fire', 'water', 'earth', 'air'].map((element, index) => derived(`${element}Resistance`, `Защита: ${['огонь', 'вода', 'земля', 'воздух'][index]}`, 'points', [['intelligence', 2000], ['vitality', 1000]], 21 + index)),
  derived('criticalChanceBps', 'Шанс критического урона', 'basis_points', [['luck', 500000]], 30, 0, 5000),
  derived('criticalBonusBps', 'Бонус критического урона', 'basis_points', [['luck', 5000000]], 31, 0, 10000),
  derived('guardPerCell', 'Защита за клетку', 'points_per_cell', [['physicalResistance', 10000], ['vitality', 7000]], 32),
];
export const ATTRIBUTE_POINTS_PER_LEVEL = 5;
export const DEFAULT_WEAPON_SCALING_BPS = 500;
