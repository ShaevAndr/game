import { Battle, Character, Content, Progression, Skill, Stats, emptyEnergy } from './types';

export function createCharacter(id: string, name: string, content: Content, templateId?: string): Character {
  const template = templateId ? content.characterTemplates.find(t => t.id === templateId) : undefined;
  if (templateId && !template) throw new Error('Тип персонажа не найден');
  const character: Character = { id, name, ...(template ? { templateId: template.id } : {}), level: 1, experience: 0, skillPoints: content.balance.progression.startingSkillPoints, learnedSkillIds: content.skills.filter(s => s.learning.starter).map(s => s.id), stats: { ...content.balance.characterStats }, energy: emptyEnergy(), inventory: structuredClone(content.balance.starterItems), createdAt: new Date().toISOString() };
  if (template) learnSkill(character, template.skillId, content);
  return character;
}

export const statNames: Record<keyof Stats, string> = { maxHp: 'Здоровье', attack: 'Атака', defense: 'Защита', maxEnergy: 'Лимит энергии' };
export function experienceToNextLevel(level: number, config: Progression): number {
  return config.baseExperience + (level - 1) * config.experiencePerLevel;
}
/** Old characters keep their existing stats and inventory and receive progression defaults. */
export function normalizeCharacter(character: Character, content: Content): Character {
  return { ...character, experience: character.experience ?? 0, skillPoints: character.skillPoints ?? (content.balance.progression.startingSkillPoints + (character.level - 1) * content.balance.progression.skillPointsPerLevel), learnedSkillIds: [...new Set([...(character.learnedSkillIds ?? []), ...content.skills.filter(s => s.learning.starter).map(s => s.id)])] };
}
export function gainExperience(character: Character, amount: number, config: Progression): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Некорректное количество опыта');
  character.experience += amount; let levels = 0;
  while (character.experience >= experienceToNextLevel(character.level, config)) {
    character.experience -= experienceToNextLevel(character.level, config); character.level++; levels++;
    character.skillPoints += config.skillPointsPerLevel;
    for (const key of Object.keys(config.statGrowth) as (keyof Stats)[]) character.stats[key] += config.statGrowth[key];
  }
  return levels;
}
export function learningBlockers(character: Character, skill: Skill, skills: Skill[]): string[] {
  if (character.learnedSkillIds.includes(skill.id)) return ['Навык уже изучен'];
  const reasons: string[] = [], requirements = skill.learning;
  if (character.skillPoints < requirements.pointCost) reasons.push(`Нужно очков навыков: ${requirements.pointCost}`);
  if (character.level < requirements.level) reasons.push(`Нужен уровень ${requirements.level}`);
  for (const id of requirements.prerequisites) if (!character.learnedSkillIds.includes(id)) reasons.push(`Сначала изучите «${skills.find(s => s.id === id)?.name ?? id}»`);
  for (const [key, value] of Object.entries(requirements.stats) as [keyof Stats, number][]) if (character.stats[key] < value) reasons.push(`${statNames[key]}: требуется ${value}`);
  return reasons;
}
export function learnSkill(character: Character, skillId: string, content: Content): void {
  const skill = content.skills.find(s => s.id === skillId);
  if (!skill) throw new Error('Навык не найден');
  const reasons = learningBlockers(character, skill, content.skills);
  if (reasons.length) throw new Error(reasons.join('; '));
  character.skillPoints -= skill.learning.pointCost; character.learnedSkillIds.push(skill.id);
}
export function victoryRecipients(battle: Battle): string[] {
  if (battle.status !== 'finished' || battle.winner === null) return [];
  return [...new Set(battle.fighters.filter(f => !f.npc && f.characterId && f.team === battle.winner).map(f => f.characterId!))].sort();
}
