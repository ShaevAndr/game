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

// Distinct v1 roles: control trades damage/energy efficiency for a chance to deny one turn.
const hit = (damageType: 'physical' | 'fire' | 'water' | 'earth' | 'air', weightBps: number, growth: number): import('./types').DamageEffect => ({
  id: 'hit', recipient: 'selected', kind: 'damage', damageType,
  magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: damageType === 'physical' ? 'physicalPower' : 'magicPower', weightBps, weightPerRankBps: growth }], min: 0, max: 1000000 },
});
const stun = (chance: number, growth = 0, cap = chance): import('./types').StunEffect => ({
  id: 'stun', name: 'Оглушение', recipient: 'selected', kind: 'stun', durationTurns: 1,
  activationChanceBps: chance, ...(growth ? { chancePerSkillRankBps: growth } : {}), maxChanceBps: cap, dispellable: true, tags: ['control'],
});
seedEffectSkills.push(
  { ...base, id: 'concussive-blow', name: 'Оглушающий удар', description: 'Умеренный физический урон и фиксированный шанс 50% пропустить следующий ход. Растёт только урон.',
    element: 'physical', cost: 6, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['lunge'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('physical', 14000, 600), stun(5000)] },
  { ...base, id: 'frost-lock', name: 'Ледяные оковы', description: 'Без урона: шанс пропуска следующего хода растёт с 65% до 80%, длительность неизменна.',
    element: 'water', cost: 5, effect: 'modifier', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['ice-shard'] },
    targeting: { kind: 'enemy_single' }, effects: [stun(6500, 200, 8000)] },
  { ...base, id: 'thunderclap', name: 'Громовой удар', description: 'Воздушный урон и шанс оглушения 25–34%. Урон и шанс растут независимо.',
    element: 'air', cost: 5, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['breeze'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('air', 12500, 700), stun(2500, 100, 3400)] },
  { ...base, id: 'earthen-grasp', name: 'Каменная хватка', description: 'Урон земли и фиксированный шанс оглушения 40%. Один пропущенный ход на любом уровне.',
    element: 'earth', cost: 6, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['pebble'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('earth', 18000, 800), stun(4000)] },
  { ...base, id: 'meteor-shower', name: 'Метеоритный дождь', description: 'Умеренный огненный урон всем живым противникам. В дуэли менее выгоден одиночной атаке.',
    element: 'fire', cost: 7, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 3, pointCost: 2, prerequisites: ['fireball'] },
    targeting: { kind: 'enemies_all' }, effects: [hit('fire', 21000, 900)] },
  { ...base, id: 'healing-rain', name: 'Целительный дождь', description: 'Лечит всех живых союзников, включая применяющего. Не воскрешает.',
    element: 'water', cost: 7, effect: 'heal', cooldown: 3, learning: { ...base.learning, level: 3, pointCost: 2, prerequisites: ['tide'] },
    targeting: { kind: 'allies_all', includeSelf: true }, effects: [{ id: 'heal', recipient: 'selected', kind: 'heal', magnitude: {
      unit: 'hp', terms: [{ scope: 'caster', statId: 'healingPower', weightBps: 19000, weightPerRankBps: 1300 }], min: 0, max: 1000000 } }] },
);

/** NPC catalog additions for the server's complete effect-enabled content snapshot. */
export const seedEnemySkillSets: Record<string, string[]> = {
  sentinel: ['strike', 'pebble', 'quake', 'earthen-grasp'],
  wisp: ['strike', 'ember', 'fireball'],
  warden: ['strike', 'cleave', 'fireball', 'concussive-blow'],
};
