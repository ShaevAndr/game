import { Content, SkillLearning } from './types';
const learning = (level: number, prerequisites: string[] = [], stats: SkillLearning['stats'] = {}, pointCost = 1): SkillLearning => ({ level, prerequisites, stats, pointCost, starter: false });
export const seedContent: Content = {
  balance: { characterStats: { maxHp: 120, attack: 8, defense: 3, maxEnergy: 30 }, starterItems: [{ itemId: 'potion', quantity: 3 }], damagePerTile: 2, energyPerTile: 1, teamSize: 3, dungeonWaves: ['sentinel', 'wisp', 'warden'], progression: { baseExperience: 100, experiencePerLevel: 50, startingSkillPoints: 2, skillPointsPerLevel: 2, statGrowth: { maxHp: 12, attack: 2, defense: 1, maxEnergy: 2 }, victoryExperience: { duel: 100, team: 140, dungeon: 240 } } },
  skills: [
    { id: 'strike', name: 'Удар', description: 'Базовая атака без затрат энергии. Известна всем персонажам.', element: 'physical', cost: 0, power: 5, effect: 'damage', cooldown: 0, learning: { ...learning(1), starter: true } },
    { id: 'ember', name: 'Искра', description: 'Первый шаг по пути огня.', element: 'fire', cost: 2, power: 10, effect: 'damage', cooldown: 0, learning: learning(1, [], { attack: 8 }) },
    { id: 'fireball', name: 'Огненный шар', description: 'Сильный удар огнём.', element: 'fire', cost: 5, power: 24, effect: 'damage', cooldown: 2, learning: learning(2, ['ember'], { attack: 10 }) },
    { id: 'inferno', name: 'Инферно', description: 'Сокрушительный удар огнём по выбранной цели.', element: 'fire', cost: 9, power: 45, effect: 'damage', cooldown: 3, learning: learning(4, ['fireball'], { attack: 14, maxEnergy: 36 }, 2) },
    { id: 'spring', name: 'Источник', description: 'Малая целительная волна для союзника.', element: 'water', cost: 2, power: 12, effect: 'heal', cooldown: 0, learning: learning(1, [], { maxHp: 120 }) },
    { id: 'tide', name: 'Живая вода', description: 'Восстанавливает здоровье союзника.', element: 'water', cost: 4, power: 25, effect: 'heal', cooldown: 2, learning: learning(2, ['spring'], { maxHp: 132 }) },
    { id: 'renewal', name: 'Возрождение', description: 'Мощное лечение живого союзника.', element: 'water', cost: 8, power: 55, effect: 'heal', cooldown: 3, learning: learning(4, ['tide'], { maxHp: 156, maxEnergy: 36 }, 2) },
    { id: 'pebble', name: 'Каменный осколок', description: 'Начальная атака стихией земли.', element: 'earth', cost: 2, power: 10, effect: 'damage', cooldown: 0, learning: learning(1, [], { defense: 3 }) },
    { id: 'quake', name: 'Разлом', description: 'Удар камня по выбранному противнику.', element: 'earth', cost: 4, power: 18, effect: 'damage', cooldown: 1, learning: learning(2, ['pebble'], { defense: 4 }) },
    { id: 'landslide', name: 'Обвал', description: 'Сокрушительная атака стихией земли.', element: 'earth', cost: 8, power: 40, effect: 'damage', cooldown: 3, learning: learning(4, ['quake'], { defense: 6 }, 2) },
    { id: 'breeze', name: 'Дуновение', description: 'Лёгкая воздушная атака.', element: 'air', cost: 2, power: 9, effect: 'damage', cooldown: 0, learning: learning(1, [], { maxEnergy: 30 }) },
    { id: 'gust', name: 'Порыв', description: 'Быстрая воздушная атака.', element: 'air', cost: 3, power: 13, effect: 'damage', cooldown: 1, learning: learning(2, ['breeze'], { maxEnergy: 32 }) },
    { id: 'tempest', name: 'Буря', description: 'Высшая ступень воздушной магии.', element: 'air', cost: 7, power: 36, effect: 'damage', cooldown: 2, learning: learning(4, ['gust'], { maxEnergy: 36, attack: 14 }, 2) },
    { id: 'cleave', name: 'Рассечение', description: 'Мощная физическая атака.', element: 'physical', cost: 5, power: 23, effect: 'damage', cooldown: 2, learning: learning(2, ['strike'], { attack: 10 }) },
    { id: 'execution', name: 'Сокрушение', description: 'Завершающая ступень боевого мастерства.', element: 'physical', cost: 9, power: 46, effect: 'damage', cooldown: 3, learning: learning(4, ['cleave'], { attack: 14, defense: 6 }, 2) },
  ],
  items: [{ id: 'potion', name: 'Зелье здоровья', description: 'Восстанавливает 35 HP. Используется вместо навыка до перестановки.', heal: 35 }],
  enemies: [
    { id: 'sentinel', name: 'Каменный страж', stats: { maxHp: 75, attack: 5, defense: 2, maxEnergy: 30 }, skillIds: ['strike', 'quake'] },
    { id: 'wisp', name: 'Огненный дух', stats: { maxHp: 65, attack: 7, defense: 1, maxEnergy: 30 }, skillIds: ['strike', 'fireball'] },
    { id: 'warden', name: 'Хранитель глубин', stats: { maxHp: 150, attack: 9, defense: 4, maxEnergy: 40 }, skillIds: ['strike', 'cleave', 'fireball'] },
  ],
};
