import type { Battle, Fighter, Skill } from '../types';
import type { SkillTargeting } from '../effects/types';

export function skillTargeting(skill: Skill): SkillTargeting {
  return skill.targeting ?? (skill.effect === 'heal' ? { kind: 'ally_single', includeSelf: true } : { kind: 'enemy_single' });
}
export function legalSkillTargets(battle: Battle, actor: Fighter, skill: Skill): Fighter[] {
  const targeting = skillTargeting(skill);
  return battle.fighters.filter(fighter => fighter.hp > 0 && (targeting.kind === 'self' ? fighter.id === actor.id
    : targeting.kind === 'enemy_single' || targeting.kind === 'enemies_all' ? fighter.team !== actor.team
    : fighter.team === actor.team && (fighter.id !== actor.id || (('includeSelf' in targeting ? targeting.includeSelf : undefined) ?? targeting.kind === 'allies_all'))))
    .sort((left, right) => left.id.localeCompare(right.id));
}
export function resolveSkillTargets(battle: Battle, actor: Fighter, skill: Skill, targetId: string): Fighter[] {
  const allowed = legalSkillTargets(battle, actor, skill), targeting = skillTargeting(skill);
  if (!allowed.length) throw new Error('Нет допустимой живой цели');
  if (targeting.kind === 'self' || targeting.kind === 'allies_all' || targeting.kind === 'enemies_all') return allowed;
  const selected = allowed.find(fighter => fighter.id === targetId);
  if (!selected) throw new Error('Выберите допустимую живую цель навыка');
  return [selected];
}
