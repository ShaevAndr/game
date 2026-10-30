import type { Character, Content, Skill, SkillProgression, Stats } from './types';

export const defaultSkillProgression: SkillProgression = { maxLevel: 10, pointCost: 1, powerPerLevel: 2 };
export function skillProgression(skill: Skill): SkillProgression { return skill.progression ?? defaultSkillProgression; }
export function skillLevel(character: Pick<Character, 'learnedSkillIds' | 'skillLevels'>, id: string): number {
  return character.learnedSkillIds.includes(id) ? character.skillLevels?.[id] ?? 1 : 0;
}
export function skillPower(skill: Skill, level = 1): number {
  return skill.power + (Math.max(1, level) - 1) * skillProgression(skill).powerPerLevel;
}
/** Preview before target resistance/guard and the direct-damage critical roll. */
export function skillMagnitude(skill: Skill, level: number, values: Record<string, number>, referencePower = 8): number {
  const power = skillPower(skill, level);
  const attribute = values[skill.effect === 'heal' ? 'healingPower' : skill.element === 'physical' ? 'physicalPower' : 'magicPower'];
  return Number(BigInt(attribute) * BigInt(power + (skill.effect === 'damage' ? referencePower : 0)) / BigInt(referencePower));
}
export function upgradeBlockers(character: Character, skill: Skill): string[] {
  const level = skillLevel(character, skill.id), progression = skillProgression(skill);
  if (!level) return ['Сначала изучите навык'];
  if (level >= progression.maxLevel) return ['Достигнут максимальный уровень'];
  return character.skillPoints < progression.pointCost ? [`Нужно очков навыков: ${progression.pointCost}`] : [];
}
export function upgradeSkill(character: Character, id: string, content: Content): void {
  const skill = content.skills.find(skill => skill.id === id);
  if (!skill) throw new Error('Навык не найден');
  const blockers = upgradeBlockers(character, skill);
  if (blockers.length) throw new Error(blockers.join('; '));
  character.skillPoints -= skillProgression(skill).pointCost;
  character.skillLevels = { ...character.skillLevels, [id]: skillLevel(character, id) + 1 };
}
/** Server rewards and consumables grant rank one; repeats never upgrade or spend points. */
export function grantSkill(character: Character, id: string, content: Content): boolean {
  if (!content.skills.some(skill => skill.id === id)) throw new Error('Навык не найден');
  if (character.learnedSkillIds.includes(id)) return false;
  character.learnedSkillIds.push(id);
  character.skillLevels = { ...character.skillLevels, [id]: 1 };
  return true;
}
export function effectiveStats(character: Pick<Character, 'stats' | 'equipmentBonuses' | 'attributes'>): Stats {
  if (character.attributes) return { maxHp: character.attributes.effective.maxHp, attack: character.attributes.effective.physicalPower, defense: character.attributes.effective.physicalResistance, maxEnergy: 30 };
  const stats = { ...character.stats };
  for (const key of Object.keys(stats) as (keyof Stats)[]) stats[key] += character.equipmentBonuses?.[key] ?? 0;
  return stats;
}
