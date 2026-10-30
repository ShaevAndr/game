import { Battle, Character, Content, Progression, Skill, Stats, emptyEnergy } from './types';
import { grantSkill } from './skills';
import { projectCharacterAttributes } from './attributes/character';
import { ATTRIBUTE_POINTS_PER_LEVEL } from './attributes/defaults';
import type { StatDefinition } from './attributes/types';

export function learningStatRequirements(character: Character, skill: Skill, definitions: StatDefinition[] = []) {
  const legacy = Object.entries(skill.learning.stats).map(([key, required]) => {
    const id = character.attributes ? key === 'attack' ? skill.element === 'physical' ? 'physicalPower' : 'magicPower' : key === 'defense' ? 'physicalResistance' : key : key;
    return { id, required: required!, actual: character.attributes && id !== 'maxEnergy' ? character.attributes.base[id] ?? 0 : character.stats[key as keyof Stats], name: definitions.find(definition => definition.id === id)?.name ?? statNames[key as keyof Stats] ?? id };
  });
  return [...legacy, ...Object.entries(skill.learning.requirements ?? {}).map(([id, required]) => ({ id, required, actual: character.attributes?.base[id] ?? 0, name: definitions.find(definition => definition.id === id)?.name ?? id }))];
}

export function createCharacter(id: string, name: string, content: Content, templateId?: string): Character {
  const template = templateId ? content.characterTemplates.find(t => t.id === templateId) : undefined;
  if (templateId && !template) throw new Error('Тип персонажа не найден');
  const character: Character = { id, name, ...(template ? { templateId: template.id } : {}), level: 1, experience: 0, skillPoints: content.balance.progression.startingSkillPoints, learnedSkillIds: content.skills.filter(s => s.learning.starter).map(s => s.id), stats: { ...content.balance.characterStats }, energy: emptyEnergy(), inventory: structuredClone(content.balance.starterItems), createdAt: new Date().toISOString() };
  character.skillLevels = Object.fromEntries(character.learnedSkillIds.map(id => [id, 1]));
  return projectCharacterAttributes(character, content);
}

export const statNames: Record<keyof Stats, string> = { maxHp: 'Здоровье', attack: 'Атака', defense: 'Защита', maxEnergy: 'Лимит энергии' };
export function experienceToNextLevel(level: number, config: Progression): number {
  return config.baseExperience + (level - 1) * config.experiencePerLevel;
}
/** Old characters keep their existing stats and inventory and receive progression defaults. */
export function normalizeCharacter(character: Character, content: Content): Character {
  const ids = [...new Set([...(character.learnedSkillIds ?? []), ...content.skills.filter(s => s.learning.starter).map(s => s.id)])];
  return projectCharacterAttributes({ ...character, skillLevels: Object.fromEntries(ids.map(id => [id, character.skillLevels?.[id] ?? 1])), experience: character.experience ?? 0, skillPoints: character.skillPoints ?? (content.balance.progression.startingSkillPoints + (character.level - 1) * content.balance.progression.skillPointsPerLevel), learnedSkillIds: [...new Set([...(character.learnedSkillIds ?? []), ...content.skills.filter(s => s.learning.starter).map(s => s.id)])] }, content);
}
export function gainExperience(character: Character, amount: number, config: Progression): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Некорректное количество опыта');
  character.experience += amount; let levels = 0;
  while (character.experience >= experienceToNextLevel(character.level, config)) {
    character.experience -= experienceToNextLevel(character.level, config); character.level++; levels++;
    character.skillPoints += config.skillPointsPerLevel;
    if (character.attributeVersion === 1) { character.attributePoints = (character.attributePoints ?? 0) + ATTRIBUTE_POINTS_PER_LEVEL; character.attributeRevision = (character.attributeRevision ?? 0) + 1; }
    else for (const key of Object.keys(config.statGrowth) as (keyof Stats)[]) character.stats[key] += config.statGrowth[key];
  }
  return levels;
}
export function learningBlockers(character: Character, skill: Skill, skills: Skill[], definitions: StatDefinition[] = []): string[] {
  if (character.learnedSkillIds.includes(skill.id)) return ['Навык уже изучен'];
  const reasons: string[] = [], requirements = skill.learning;
  if (character.skillPoints < requirements.pointCost) reasons.push(`Нужно очков навыков: ${requirements.pointCost}`);
  if (character.level < requirements.level) reasons.push(`Нужен уровень ${requirements.level}`);
  for (const id of requirements.prerequisites) if (!character.learnedSkillIds.includes(id)) reasons.push(`Сначала изучите «${skills.find(s => s.id === id)?.name ?? id}»`);
  for (const requirement of learningStatRequirements(character, skill, definitions)) if (requirement.actual < requirement.required) reasons.push(`${requirement.name}: требуется ${requirement.required}`);
  return reasons;
}
export function learnSkill(character: Character, skillId: string, content: Content): void {
  const skill = content.skills.find(s => s.id === skillId);
  if (!skill) throw new Error('Навык не найден');
  const reasons = learningBlockers(character, skill, content.skills, content.statDefinitions);
  if (reasons.length) throw new Error(reasons.join('; '));
  character.skillPoints -= skill.learning.pointCost; grantSkill(character, skill.id, content);
}
export function victoryRecipients(battle: Battle): string[] {
  if (battle.status !== 'finished' || battle.winner === null) return [];
  return [...new Set(battle.fighters.filter(f => !f.npc && f.characterId && f.team === battle.winner).map(f => f.characterId!))].sort();
}
