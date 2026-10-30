import type { Skill } from '../types';
import type { StatModifierEffect } from './types';

const modifier = (id: string, statId: string, weightBps: number, polarity: 'buff' | 'debuff'): StatModifierEffect => ({
  id, kind: 'stat_modifier', recipient: 'selected', polarity, statId, operation: 'add_percent',
  magnitude: { unit: 'basis_points', terms: [{ scope: 'caster', statId: 'intelligence', weightBps, weightPerRankBps: weightBps > 0 ? 100000 : -100000 }], min: -7500, max: 10000 },
  durationTurns: 2, stackKey: id, stacking: 'refresh', dispellable: true, tags: [polarity === 'buff' ? 'enhancement' : 'weakening'],
});
const base = { power: 0, cooldown: 2, learning: { pointCost: 1, level: 1, prerequisites: [], stats: {}, starter: false }, progression: { maxLevel: 10, pointCost: 1, powerPerLevel: 0 } };

/** Seeded separately from the historical catalog so saved legacy fixtures remain reproducible. */
export const seedEffectSkills: Skill[] = [
  { ...base, id: 'battle-cry', name: 'Боевой клич', description: 'Усиливает силу себя или союзника на два его следующих хода. При интеллекте 10: +20%.', element: 'physical', cost: 3, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [modifier('battle-cry-strength', 'strength', 2000000, 'buff')] },
  { ...base, id: 'weakening', name: 'Ослабление', description: 'Снижает физическую мощь противника на два его хода. При интеллекте 10: −20%.', element: 'physical', cost: 3, effect: 'modifier',
    targeting: { kind: 'enemy_single' }, effects: [modifier('weakening-power', 'physicalPower', -2000000, 'debuff')] },
  { ...base, id: 'fire-vulnerability', name: 'Уязвимость к огню', description: 'Снижает защиту противника от огня на два его хода. При интеллекте 10: −25%.', element: 'fire', cost: 3, effect: 'modifier',
    targeting: { kind: 'enemy_single' }, effects: [modifier('fire-vulnerability-resistance', 'fireResistance', -2500000, 'debuff')] },
  { ...base, id: 'purify', name: 'Очищение', description: 'Снимает один снимаемый дебаф с себя или союзника, начиная с самого раннего.', element: 'water', cost: 3, effect: 'dispel',
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [{ id: 'purify-debuff', kind: 'dispel', recipient: 'selected', polarityToRemove: 'debuff', maxCount: 1 }] },
  { ...base, id: 'stone-skin', name: 'Каменная кожа', description: 'Усиливает собственную физическую защиту на два следующих хода. При интеллекте 10: +50%.', element: 'earth', cost: 4, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'self' }, effects: [modifier('stone-skin-armor', 'physicalResistance', 5000000, 'buff')] },
  { ...base, id: 'arcane-focus', name: 'Магическая концентрация', description: 'Усиливает магическую мощь себя или союзника на два его следующих хода. При интеллекте 10: +20%.', element: 'air', cost: 3, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [modifier('arcane-focus-power', 'magicPower', 2000000, 'buff')] },
  { ...base, id: 'rending-strike', name: 'Рассекающий удар', description: 'Сначала снижает физическую защиту противника на два его хода, затем наносит физический урон.', element: 'physical', cost: 5, effect: 'damage', cooldown: 3,
    learning: { ...base.learning, level: 2 }, targeting: { kind: 'enemy_single' }, effects: [modifier('rending-strike-armor', 'physicalResistance', -2500000, 'debuff'),
      { id: 'rending-strike-hit', kind: 'damage', recipient: 'selected', damageType: 'physical', canCrit: true,
        magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: 'physicalPower', weightBps: 15000, weightPerRankBps: 1000 }], min: 0, max: 1000000 } }] },
];
