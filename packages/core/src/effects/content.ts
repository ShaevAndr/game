import { withSeedSkillTree } from '../skill-tree-content';
import type { Skill } from '../types';
import type { StatModifierEffect } from './types';

const modifier = (id: string, statId: string, weightBps: number, polarity: 'buff' | 'debuff', scalingStat = 'intelligence', min = -7500, max = 10000): StatModifierEffect => ({
  id, kind: 'stat_modifier', recipient: 'selected', polarity, statId, operation: 'add_percent',
  magnitude: { unit: 'basis_points', terms: [{ scope: 'caster', statId: scalingStat, weightBps, weightPerRankBps: weightBps > 0 ? 100000 : -100000 }], min, max },
  durationTurns: 2, stackKey: id, stacking: 'refresh', dispellable: true, tags: [polarity === 'buff' ? 'enhancement' : 'weakening'],
});
const base = { power: 0, cooldown: 2, learning: { pointCost: 1, level: 1, prerequisites: [], stats: {}, starter: false }, progression: { maxLevel: 10, pointCost: 1, powerPerLevel: 0 } };

/** Seeded separately from the historical catalog so saved legacy fixtures remain reproducible. */
const rawEffectSkills: Skill[] = [
  { ...base, id: 'battle-cry', matchBonus: false, name: 'Боевой клич', description: 'Усиливает силу себя или союзника на два его следующих хода. При силе 10: +20%.', element: 'physical', cost: 8, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [modifier('battle-cry-strength', 'strength', 2000000, 'buff', 'strength', 0, 3500)] },
  { ...base, id: 'weakening', matchBonus: false, name: 'Ослабление', description: 'Снижает физическую мощь противника на два его хода. При силе 10: −20%.', element: 'physical', cost: 8, effect: 'modifier',
    targeting: { kind: 'enemy_single' }, effects: [modifier('weakening-power', 'physicalPower', -2000000, 'debuff', 'strength', -3500, 0)] },
  { ...base, id: 'fire-vulnerability', name: 'Уязвимость к огню', description: 'Снижает защиту противника от огня на два его хода. При интеллекте 10: −25%.', element: 'fire', cost: 10, effect: 'modifier',
    targeting: { kind: 'enemy_single' }, effects: [modifier('fire-vulnerability-resistance', 'fireResistance', -2500000, 'debuff')] },
  { ...base, id: 'purify', name: 'Очищение', description: 'Снимает один снимаемый дебаф с себя или союзника, начиная с самого раннего.', element: 'water', cost: 8, effect: 'dispel',
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [{ id: 'purify-debuff', kind: 'dispel', recipient: 'selected', polarityToRemove: 'debuff', maxCount: 1 }] },
  { ...base, id: 'stone-skin', name: 'Каменная кожа', description: 'Усиливает собственную физическую защиту на два следующих хода. При выносливости 10: +50%.', element: 'earth', cost: 10, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'self' }, effects: [modifier('stone-skin-armor', 'physicalResistance', 5000000, 'buff', 'vitality')] },
  { ...base, id: 'arcane-focus', name: 'Магическая концентрация', description: 'Усиливает магическую мощь себя или союзника на два его следующих хода. При интеллекте 10: +20%.', element: 'air', cost: 8, effect: 'modifier', cooldown: 3,
    targeting: { kind: 'ally_single', includeSelf: true }, effects: [modifier('arcane-focus-power', 'magicPower', 2000000, 'buff')] },
  { ...base, id: 'rending-strike', name: 'Рассекающий удар', description: 'Сначала снижает физическую защиту противника на два его хода, затем наносит физический урон.', element: 'physical', cost: 25, effect: 'damage', cooldown: 3,
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
rawEffectSkills.push(
  { ...base, id: 'concussive-blow', name: 'Оглушающий удар', description: 'Умеренный физический урон и фиксированный шанс 50% пропустить следующий ход. Растёт только урон.',
    element: 'physical', cost: 25, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['lunge'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('physical', 14000, 600), stun(5000)] },
  { ...base, id: 'frost-lock', name: 'Ледяные оковы', description: 'Без урона: шанс пропуска следующего хода растёт с 50% до 59%, длительность неизменна.',
    element: 'water', cost: 20, effect: 'modifier', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['ice-shard'] },
    targeting: { kind: 'enemy_single' }, effects: [stun(5000, 100, 5900)] },
  { ...base, id: 'thunderclap', name: 'Громовой удар', description: 'Воздушный урон и шанс оглушения 25–34%. Урон и шанс растут независимо.',
    element: 'air', cost: 25, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['breeze'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('air', 12500, 700), stun(2500, 100, 3400)] },
  { ...base, id: 'earthen-grasp', name: 'Каменная хватка', description: 'Урон земли и фиксированный шанс оглушения 40%. Один пропущенный ход на любом уровне.',
    element: 'earth', cost: 30, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 2, pointCost: 2, prerequisites: ['pebble'] },
    targeting: { kind: 'enemy_single' }, effects: [hit('earth', 18000, 800), stun(4000)] },
  { ...base, id: 'meteor-shower', name: 'Метеоритный дождь', description: 'Умеренный огненный урон всем живым противникам. В дуэли менее выгоден одиночной атаке.',
    element: 'fire', cost: 35, effect: 'damage', cooldown: 3, learning: { ...base.learning, level: 3, pointCost: 2, prerequisites: ['fireball'] },
    targeting: { kind: 'enemies_all' }, effects: [hit('fire', 15000, 600)] },
  { ...base, id: 'healing-rain', name: 'Целительный дождь', description: 'Лечит всех живых союзников, включая применяющего. Не воскрешает.',
    element: 'water', cost: 15, effect: 'heal', cooldown: 3, learning: { ...base.learning, level: 3, pointCost: 2, prerequisites: ['tide'] },
    targeting: { kind: 'allies_all', includeSelf: true }, effects: [{ id: 'heal', recipient: 'selected', kind: 'heal', magnitude: {
      unit: 'hp', terms: [{ scope: 'caster', statId: 'healingPower', weightBps: 12500, weightPerRankBps: 400 }], min: 0, max: 1000000 } }] },
);

// School identities: fire pressure, water recovery, earth barriers, air tempo, physical attrition.
const hp = (statId: string, weightBps: number, weightPerRankBps = 300): import('./types').EffectExpression => ({
  unit: 'hp', terms: [{ scope: 'caster', statId, weightBps, weightPerRankBps }], min: 0, max: 1000000,
});
rawEffectSkills.push(
  { ...base, id: 'flying-blade', name: 'Летящий клинок', description: 'Воздух направляет клинок: физический урон от физической мощи. Даёт бойцу второй тип полезных совпадений за очко навыка.',
    element: 'air', cost: 3, effect: 'damage', cooldown: 0, targeting: { kind: 'enemy_single' },
    effects: [{ id: 'blade', kind: 'damage', recipient: 'selected', damageType: 'physical', magnitude: hp('physicalPower', 18000, 500) }] },
  { ...base, id: 'burning-brand', name: 'Ожог', description: 'Накладывает ожог на три собственных хода врага. Сильнее прямого удара суммарно, но снимается очищением.',
    element: 'fire', cost: 12, effect: 'damage', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['ember'] }, targeting: { kind: 'enemy_single' },
    effects: [{ id: 'burn', kind: 'periodic_damage', recipient: 'selected', damageType: 'fire', magnitude: hp('magicPower', 12500, 350), durationTurns: 3, stackKey: 'burning', tags: ['burn'], stacking: 'refresh' }] },
  { ...base, id: 'mending-stream', name: 'Поток восстановления', description: 'Восстанавливает здоровье в начале трёх следующих собственных ходов союзника. Не спасает от немедленного добивания.',
    element: 'water', cost: 10, effect: 'heal', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['spring'] }, targeting: { kind: 'ally_single', includeSelf: true },
    effects: [{ id: 'regeneration', kind: 'periodic_heal', recipient: 'selected', magnitude: hp('healingPower', 8500, 250), durationTurns: 3, stackKey: 'regeneration', tags: ['regeneration'] }] },
  { ...base, id: 'earthen-barrier', name: 'Каменный заслон', description: 'Даёт союзнику щит на два его следующих хода. Поглощает урон после брони; повтор обновляет щит без сложения.',
    element: 'earth', cost: 10, effect: 'modifier', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['pebble'] }, targeting: { kind: 'ally_single', includeSelf: true },
    effects: [{ id: 'barrier', kind: 'shield', recipient: 'selected', magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: 'vitality', weightBps: 12000, weightPerRankBps: 350 }, { scope: 'caster', statId: 'physicalResistance', weightBps: 10000 }], min: 0 }, durationTurns: 2, stackKey: 'earthen-barrier', tags: ['barrier'] }] },
  { ...base, id: 'sheltering-wind', name: 'Попутный ветер', description: 'Малое немедленное лечение и короткий щит: уступает специализированному лечению и заслону по отдельности.',
    element: 'air', cost: 12, effect: 'heal', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['soothing-wind'] }, targeting: { kind: 'ally_single', includeSelf: true },
    effects: [{ id: 'mend', kind: 'heal', recipient: 'selected', magnitude: hp('healingPower', 6000, 200) },
      { id: 'shelter', kind: 'shield', recipient: 'selected', magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: 'vitality', weightBps: 8000, weightPerRankBps: 200 }, { scope: 'caster', statId: 'airResistance', weightBps: 5000 }], min: 0 }, durationTurns: 1, stackKey: 'sheltering-wind' }] },
  { ...base, id: 'bleeding-cut', name: 'Кровоточащий порез', description: 'Небольшой физический удар и кровотечение на два собственных хода цели. Дополнительный плоский урон не повторяется на тиках.',
    element: 'physical', cost: 15, effect: 'damage', cooldown: 2, learning: { ...base.learning, level: 2, prerequisites: ['lunge'] }, targeting: { kind: 'enemy_single' },
    effects: [hit('physical', 10000, 300), { id: 'bleed', kind: 'periodic_damage', recipient: 'selected', damageType: 'physical', magnitude: hp('physicalPower', 10000, 300), durationTurns: 2, stackKey: 'bleeding', tags: ['bleed'] }] },
  { ...base, id: 'purging-flame', name: 'Очищающее пламя', description: 'Наносит умеренный урон и снимает один снимаемый баф противника, включая щит.',
    element: 'fire', cost: 25, effect: 'damage', cooldown: 2, learning: { ...base.learning, level: 3, prerequisites: ['fireball'] }, targeting: { kind: 'enemy_single' },
    effects: [{ id: 'purge', kind: 'dispel', recipient: 'selected', polarityToRemove: 'buff', maxCount: 1 }, hit('fire', 18000, 500)] },
);

/** NPC catalog additions for the server's complete effect-enabled content snapshot. */
export const seedEnemySkillSets: Record<string, string[]> = {
  sentinel: ['strike', 'pebble', 'quake', 'earthen-barrier'],
  wisp: ['strike', 'ember', 'fireball', 'burning-brand'],
  warden: ['strike', 'cleave', 'fireball', 'concussive-blow'],
};

// Universal physical techniques: their strength is independent of tile colors and match size.
rawEffectSkills.push(
  { ...base, id: 'brace', name: 'Собраться', description: 'Щит от выносливости и физической защиты. Любой тип поля, без бонуса совпадения.',
    element: 'physical', matchBonus: false, cost: 8, effect: 'modifier', cooldown: 2, targeting: { kind: 'self' },
    effects: [{ id: 'brace', kind: 'shield', recipient: 'caster', magnitude: { unit: 'hp', terms: [
      { scope: 'caster', statId: 'vitality', weightBps: 9000, weightPerRankBps: 250 },
      { scope: 'caster', statId: 'physicalResistance', weightBps: 5000 }], min: 0 }, durationTurns: 2 }] },
  { ...base, id: 'trip', name: 'Подсечка', description: '45% пропуска следующего хода врага. Без урона и бонуса клеток.',
    element: 'physical', matchBonus: false, cost: 12, effect: 'modifier', cooldown: 3,
    learning: { ...base.learning, level: 2, prerequisites: ['lunge'] }, targeting: { kind: 'enemy_single' }, effects: [stun(4500)] },
  { ...base, id: 'disorient', name: 'Сбить прицел', description: 'На два хода снижает точность оружия на 20%, магии на 10%. Сила не зависит от типа клеток.',
    element: 'physical', matchBonus: false, cost: 10, effect: 'modifier', cooldown: 3, targeting: { kind: 'enemy_single' },
    effects: [
      { id: 'weapon-aim', kind: 'stat_modifier', recipient: 'selected', statId: 'accuracy', operation: 'add_percent', polarity: 'debuff', magnitude: { unit: 'basis_points', constant: -2000 }, durationTurns: 2 },
      { id: 'magic-aim', kind: 'stat_modifier', recipient: 'selected', statId: 'magicAccuracy', operation: 'add_percent', polarity: 'debuff', magnitude: { unit: 'basis_points', constant: -1000 }, durationTurns: 2 },
    ] },
  { ...base, id: 'battle-focus', name: 'Боевая собранность', description: 'Усиливает физический крит на два хода. Базово +4 п.п., дополнительно зависит от ловкости.',
    element: 'physical', matchBonus: false, cost: 10, effect: 'modifier', cooldown: 3, targeting: { kind: 'self' },
    effects: [{ id: 'focus', kind: 'stat_modifier', recipient: 'caster', statId: 'physicalCriticalChanceBps', operation: 'add_flat', polarity: 'buff',
      magnitude: { unit: 'basis_points', constant: 400, terms: [{ scope: 'caster', statId: 'dexterity', weightBps: 10000, weightPerRankBps: 10000 }], min: 0, max: 1500 }, durationTurns: 2 }] },
);

rawEffectSkills.push({ ...base, id: 'precise-thrust', name: 'Точный выпад',
  description: 'Базовая атака ловкого бойца: физическая мощь и ловкость определяют урон, ловкость — крит и точность.',
  element: 'physical', cost: 3, effect: 'damage', cooldown: 0,
  learning: { ...base.learning, requirements: { dexterity: 12 } }, targeting: { kind: 'enemy_single' },
  effects: [{ id: 'thrust', kind: 'damage', recipient: 'selected', damageType: 'physical', magnitude: { unit: 'hp', min: 0,
    terms: [{ scope: 'caster', statId: 'physicalPower', weightBps: 10000 },
      { scope: 'caster', statId: 'dexterity', weightBps: 11000, weightPerRankBps: 1000 }] } }],
});

export const seedEffectSkills: Skill[] = withSeedSkillTree(rawEffectSkills);
