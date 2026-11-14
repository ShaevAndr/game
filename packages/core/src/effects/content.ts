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
  { ...base, id: 'battle-cry', name: 'Боевой клич', description: 'Усиливает силу себя или союзника на два его следующих хода. При интеллекте 10: +20%.', element: 'physical', cost: 30, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [modifier('battle-cry-strength', 'strength', 2000000, 'buff')] },
  { ...base, id: 'weakening', name: 'Ослабление', description: 'Снижает физическую мощь противника на два его хода. При интеллекте 10: −20%.', element: 'physical', cost: 30, effect: 'modifier',
    targeting: { kind: 'enemy_single' }, effects: [modifier('weakening-power', 'physicalPower', -2000000, 'debuff')] },
  { ...base, id: 'fire-vulnerability', name: 'Уязвимость к огню', description: 'Снижает защиту противника от огня на два его хода. При интеллекте 10: −25%.', element: 'fire', cost: 30, effect: 'modifier',
    targeting: { kind: 'enemy_single' }, effects: [modifier('fire-vulnerability-resistance', 'fireResistance', -2500000, 'debuff')] },
  { ...base, id: 'purify', name: 'Очищение', description: 'Снимает один снимаемый дебаф с себя или союзника, начиная с самого раннего.', element: 'water', cost: 30, effect: 'dispel',
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [{ id: 'purify-debuff', kind: 'dispel', recipient: 'selected', polarityToRemove: 'debuff', maxCount: 1 }] },
  { ...base, id: 'stone-skin', name: 'Каменная кожа', description: 'Усиливает собственную физическую защиту на два следующих хода. При интеллекте 10: +50%.', element: 'earth', cost: 40, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'self' }, effects: [modifier('stone-skin-armor', 'physicalResistance', 5000000, 'buff')] },
  { ...base, id: 'arcane-focus', name: 'Магическая концентрация', description: 'Усиливает магическую мощь себя или союзника на два его следующих хода. При интеллекте 10: +20%.', element: 'air', cost: 30, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [modifier('arcane-focus-power', 'magicPower', 2000000, 'buff')] },
  { ...base, id: 'rending-strike', name: 'Рассекающий удар', description: 'Сначала снижает физическую защиту противника на два его хода, затем наносит физический урон.', element: 'physical', cost: 50, effect: 'damage', cooldown: 3,
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
    element: 'physical', cost: 60, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['lunge'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('physical', 14000, 600), stun(5000)] },
  { ...base, id: 'frost-lock', name: 'Ледяные оковы', description: 'Без урона: шанс пропуска следующего хода растёт с 50% до 59%, длительность неизменна.',
    element: 'water', cost: 50, effect: 'modifier', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['ice-shard'] },
    targeting: { kind: 'enemy_single' }, effects: [stun(5000, 100, 5900)] },
  { ...base, id: 'thunderclap', name: 'Громовой удар', description: 'Воздушный урон и шанс оглушения 25–34%. Урон и шанс растут независимо.',
    element: 'air', cost: 50, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['breeze'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('air', 12500, 700), stun(2500, 100, 3400)] },
  { ...base, id: 'earthen-grasp', name: 'Каменная хватка', description: 'Урон земли и фиксированный шанс оглушения 40%. Один пропущенный ход на любом уровне.',
    element: 'earth', cost: 60, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['pebble'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('earth', 18000, 800), stun(4000)] },
  { ...base, id: 'meteor-shower', name: 'Метеоритный дождь', description: 'Умеренный огненный урон всем живым противникам. В дуэли менее выгоден одиночной атаке.',
    element: 'fire', cost: 70, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 3, pointCost: 2, prerequisites: ['fireball'] },
    targeting: { kind: 'enemies_all' }, effects: [hit('fire', 15000, 600)] },
  { ...base, id: 'healing-rain', name: 'Целительный дождь', description: 'Лечит всех живых союзников, включая применяющего. Не воскрешает.',
    element: 'water', cost: 70, effect: 'heal', cooldown: 3, learning: { ...base.learning, level: 3, pointCost: 2, prerequisites: ['tide'] },
    targeting: { kind: 'allies_all', includeSelf: true }, effects: [{ id: 'heal', recipient: 'selected', kind: 'heal', magnitude: {
      unit: 'hp', terms: [{ scope: 'caster', statId: 'healingPower', weightBps: 12500, weightPerRankBps: 400 }], min: 0, max: 1000000 } }] },
);

// School identities: fire pressure, water recovery, earth barriers, air tempo, physical attrition.
const hp = (statId: string, weightBps: number, weightPerRankBps = 300): import('./types').EffectExpression => ({
  unit: 'hp', terms: [{ scope: 'caster', statId, weightBps, weightPerRankBps }], min: 0, max: 1000000,
});
seedEffectSkills.push(
  { ...base, id: 'flying-blade', name: 'Летящий клинок', description: 'Воздух направляет клинок: физический урон от физической мощи. Даёт бойцу второй тип полезных совпадений за очко навыка.',
    element: 'air', cost: 30, effect: 'damage', cooldown: 0, targeting: { kind: 'enemy_single' },
    effects: [{ id: 'blade', kind: 'damage', recipient: 'selected', damageType: 'physical', magnitude: hp('physicalPower', 18000, 500) }] },
  { ...base, id: 'burning-brand', name: 'Ожог', description: 'Накладывает ожог на три собственных хода врага. Сильнее прямого удара суммарно, но снимается очищением.',
    element: 'fire', cost: 40, effect: 'damage', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['ember'] }, targeting: { kind: 'enemy_single' },
    effects: [{ id: 'burn', kind: 'periodic_damage', recipient: 'selected', damageType: 'fire', magnitude: hp('magicPower', 12500, 350), durationTurns: 3, stackKey: 'burning', tags: ['burn'], stacking: 'refresh' }] },
  { ...base, id: 'mending-stream', name: 'Поток восстановления', description: 'Восстанавливает здоровье в начале трёх следующих собственных ходов союзника. Не спасает от немедленного добивания.',
    element: 'water', cost: 40, effect: 'heal', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['spring'] }, targeting: { kind: 'ally_single', includeSelf: true },
    effects: [{ id: 'regeneration', kind: 'periodic_heal', recipient: 'selected', magnitude: hp('healingPower', 8500, 250), durationTurns: 3, stackKey: 'regeneration', tags: ['regeneration'] }] },
  { ...base, id: 'earthen-barrier', name: 'Каменный заслон', description: 'Даёт союзнику щит на два его следующих хода. Поглощает урон после брони; повтор обновляет щит без сложения.',
    element: 'earth', cost: 40, effect: 'modifier', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['pebble'] }, targeting: { kind: 'ally_single', includeSelf: true },
    effects: [{ id: 'barrier', kind: 'shield', recipient: 'selected', magnitude: hp('magicPower', 20000, 600), durationTurns: 2, stackKey: 'earthen-barrier', tags: ['barrier'] }] },
  { ...base, id: 'sheltering-wind', name: 'Попутный ветер', description: 'Малое немедленное лечение и короткий щит: уступает специализированному лечению и заслону по отдельности.',
    element: 'air', cost: 40, effect: 'heal', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['soothing-wind'] }, targeting: { kind: 'ally_single', includeSelf: true },
    effects: [{ id: 'mend', kind: 'heal', recipient: 'selected', magnitude: hp('healingPower', 6000, 200) },
      { id: 'shelter', kind: 'shield', recipient: 'selected', magnitude: hp('magicPower', 10000, 300), durationTurns: 1, stackKey: 'sheltering-wind' }] },
  { ...base, id: 'bleeding-cut', name: 'Кровоточащий порез', description: 'Небольшой физический удар и кровотечение на два собственных хода цели. Дополнительный плоский урон не повторяется на тиках.',
    element: 'physical', cost: 40, effect: 'damage', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['lunge'] }, targeting: { kind: 'enemy_single' },
    effects: [hit('physical', 10000, 300), { id: 'bleed', kind: 'periodic_damage', recipient: 'selected', damageType: 'physical', magnitude: hp('physicalPower', 10000, 300), durationTurns: 2, stackKey: 'bleeding', tags: ['bleed'] }] },
  { ...base, id: 'purging-flame', name: 'Очищающее пламя', description: 'Наносит умеренный урон и снимает один снимаемый баф противника, включая щит.',
    element: 'fire', cost: 50, effect: 'damage', cooldown: 2, learning: { ...base.learning, level: 3, prerequisites: ['fireball'] }, targeting: { kind: 'enemy_single' },
    effects: [{ id: 'purge', kind: 'dispel', recipient: 'selected', polarityToRemove: 'buff', maxCount: 1 }, hit('fire', 18000, 500)] },
);

/** NPC catalog additions for the server's complete effect-enabled content snapshot. */
export const seedEnemySkillSets: Record<string, string[]> = {
  sentinel: ['strike', 'pebble', 'quake', 'earthen-barrier'],
  wisp: ['strike', 'ember', 'fireball', 'burning-brand'],
  warden: ['strike', 'cleave', 'fireball', 'concussive-blow'],
};
