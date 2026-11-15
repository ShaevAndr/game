import type { Skill } from './types';
import type { SkillBranch, SkillIcon } from './skill-tree';

// Catalog assignments, not executable skill-specific rules. Neighbours are alternatives.
const nodes: { branch: SkillBranch; icons: Record<string, SkillIcon> }[] = [
  { branch: { id: 'fire-origin', name: 'Пробуждение пламени', parents: [], order: 0 }, icons: { ember: 'spark', 'phoenix-warmth': 'heart', 'fire-vulnerability': 'eye' } },
  { branch: { id: 'fire-pressure', name: 'Пламя и разрушение', parents: ['fire-origin'], order: 10 }, icons: { fireball: 'flame', 'burning-brand': 'wound' } },
  { branch: { id: 'fire-recovery', name: 'Путь феникса', parents: ['fire-origin'], order: 11 }, icons: { 'healing-flame': 'phoenix' } },
  { branch: { id: 'fire-mastery', name: 'Власть над огнём', parents: ['fire-pressure'], order: 20 }, icons: { inferno: 'storm', 'meteor-shower': 'meteor', 'purging-flame': 'cleanse' } },
  { branch: { id: 'fire-rebirth', name: 'Сердце феникса', parents: ['fire-recovery'], order: 21 }, icons: { 'phoenix-heart': 'phoenix' } },
  { branch: { id: 'water-origin', name: 'Первый источник', parents: [], order: 0 }, icons: { 'ice-shard': 'ice', spring: 'drop', purify: 'cleanse' } },
  { branch: { id: 'water-frost', name: 'Лёд и оковы', parents: ['water-origin'], order: 10 }, icons: { 'ice-lance': 'ice', 'frost-lock': 'chain' } },
  { branch: { id: 'water-flow', name: 'Живой поток', parents: ['water-origin'], order: 11 }, icons: { tide: 'wave', 'mending-stream': 'heart' } },
  { branch: { id: 'water-glacier', name: 'Вечная мерзлота', parents: ['water-frost'], order: 20 }, icons: { glacier: 'snowflake' } },
  { branch: { id: 'water-renewal', name: 'Сила обновления', parents: ['water-flow'], order: 21 }, icons: { renewal: 'heart', 'healing-rain': 'drop' } },
  { branch: { id: 'earth-origin', name: 'Сила земли', parents: [], order: 0 }, icons: { pebble: 'stone', lifesap: 'leaf', 'stone-skin': 'shield' } },
  { branch: { id: 'earth-rift', name: 'Разлом и хватка', parents: ['earth-origin'], order: 10 }, icons: { quake: 'mountain', 'earthen-grasp': 'fist' } },
  { branch: { id: 'earth-grove', name: 'Камень и корни', parents: ['earth-origin'], order: 11 }, icons: { grove: 'tree', 'earthen-barrier': 'barrier' } },
  { branch: { id: 'earth-collapse', name: 'Гнев гор', parents: ['earth-rift'], order: 20 }, icons: { landslide: 'mountain' } },
  { branch: { id: 'earth-life', name: 'Древо жизни', parents: ['earth-grove'], order: 21 }, icons: { 'world-tree': 'tree' } },
  { branch: { id: 'air-origin', name: 'Дыхание ветра', parents: [], order: 0 }, icons: { breeze: 'wind', 'soothing-wind': 'feather', 'arcane-focus': 'focus', 'flying-blade': 'sword' } },
  { branch: { id: 'air-storm', name: 'Сердце бури', parents: ['air-origin'], order: 10 }, icons: { gust: 'wind', thunderclap: 'bolt' } },
  { branch: { id: 'air-shelter', name: 'Попутный ветер', parents: ['air-origin'], order: 11 }, icons: { 'cloud-rest': 'feather', 'sheltering-wind': 'barrier' } },
  { branch: { id: 'air-tempest', name: 'Повелитель бури', parents: ['air-storm'], order: 20 }, icons: { tempest: 'storm' } },
  { branch: { id: 'air-blessing', name: 'Благословение неба', parents: ['air-shelter'], order: 21 }, icons: { 'sky-blessing': 'phoenix' } },
  { branch: { id: 'physical-origin', name: 'Основы мастерства', parents: [], order: 0 }, icons: { strike: 'sword', lunge: 'dagger', 'precise-thrust': 'focus', 'second-wind': 'heart' } },
  { branch: { id: 'physical-assault', name: 'Искусство натиска', parents: ['physical-origin'], order: 10 }, icons: { cleave: 'axes', 'rending-strike': 'sword', 'concussive-blow': 'fist', 'bleeding-cut': 'wound' } },
  { branch: { id: 'physical-tactics', name: 'Стойкость и хитрость', parents: ['physical-origin'], order: 11 }, icons: { brace: 'shield', 'battle-cry': 'fist', weakening: 'wound', trip: 'chain', disorient: 'eye', 'battle-focus': 'focus' } },
  { branch: { id: 'physical-mastery', name: 'Мастер оружия', parents: ['physical-assault'], order: 20 }, icons: { execution: 'axes', 'blade-dance': 'dagger' } },
];

export function withSeedSkillTree(skills: Skill[]): Skill[] {
  return skills.map(skill => {
    const node = nodes.find(node => Object.hasOwn(node.icons, skill.id));
    return node ? { ...skill, icon: node.icons[skill.id], learning: { ...skill.learning, prerequisites: [], branch: structuredClone(node.branch) } } : skill;
  });
}
