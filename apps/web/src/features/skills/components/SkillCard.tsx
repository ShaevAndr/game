import { branchLearningRequirements, learningBlockers, learningStatRequirements, skillLevel, skillPower, skillProgression, upgradeBlockers,
  type Character, type Content, type Skill } from '@game/core';
import { SkillEmblem } from './SkillEmblem';
import { targetingLabels } from '../../../shared/ui/effect-labels';

interface Props { skill: Skill; content: Content; character?: Character; busy: boolean; onLearn: (id: string) => void; onUpgrade: (id: string, level: number) => void }
export function SkillCard({ skill, content, character, busy, onLearn, onUpgrade }: Props) {
  const level = character ? skillLevel(character, skill.id) : 0;
  const progression = skillProgression(skill), learned = level > 0;
  const blockers = character ? learningBlockers(character, skill, content.skills, content.statDefinitions) : ['Выберите персонажа'];
  const upgradeReasons = character ? upgradeBlockers(character, skill) : ['Выберите персонажа'];
  const available = !learned && blockers.length === 0;
  const branches = branchLearningRequirements(character?.learnedSkillIds ?? [], skill, content.skills);
  const reasons = learned ? upgradeReasons : blockers;
  return <article className={`skill-node skill-tree-card ${learned ? 'learned' : available ? 'available' : 'locked'}`} data-skill-id={skill.id}>
    <div className="skill-card-heading">
      <SkillEmblem icon={skill.icon ?? (skill.effect === 'heal' ? 'heart' : skill.effect === 'damage' ? 'spark' : 'focus')} element={skill.element}/>
      <div><div className="node-status">{learned ? `ИЗУЧЕНО · ${level}/${progression.maxLevel}` : available ? 'МОЖНО ИЗУЧИТЬ' : 'НЕ ИЗУЧЕНО'}</div><h4>{skill.name}</h4></div>
    </div>
    <p className="node-description">{skill.description}</p>
    <div className="skill-card-metrics"><span title="Цена применения в бою">⚡ <b>{skill.cost}</b> энергии</span><span>◷ <b>{skill.cooldown}</b> КД</span><span>Ур. <b>{skill.learning.level}</b></span></div>
    <details className="skill-card-details" open><summary>Требования и действие <span>⌄</span></summary>
      <ul className="skill-requirements">
        <li className={character && character.skillPoints >= skill.learning.pointCost ? 'met' : ''}>Изучение: {skill.learning.pointCost} ОН · есть {character?.skillPoints ?? '—'}</li>
        <li className={character && character.level >= skill.learning.level ? 'met' : ''}>Уровень героя: {skill.learning.level}</li>
        {branches.map(branch => <li key={branch.id} className={branch.met ? 'met' : ''}>Любой навык узла «{branch.name}»</li>)}
        {skill.learning.prerequisites.map(id => <li key={id} className={character?.learnedSkillIds.includes(id) ? 'met' : ''}>Навык «{content.skills.find(skill => skill.id === id)?.name ?? id}»</li>)}
        {character && learningStatRequirements(character, skill, content.statDefinitions).map((requirement, index) => <li key={`${requirement.id}:${index}`} className={requirement.actual >= requirement.required ? 'met' : ''}>{requirement.name} ≥ {requirement.required} · есть {requirement.actual}</li>)}
      </ul>
      {skill.effects?.length ? <><p className="skill-target-note">{targetingLabels[skill.targeting!.kind]}</p><ul className="skill-effects-list">{skill.effects.map(effect => <li key={effect.id}>{effect.kind === 'stat_modifier' ? `${effect.polarity === 'buff' ? 'Усиление' : 'Ослабление'}: ${content.statDefinitions?.find(definition => definition.id === effect.statId)?.name ?? effect.statId}`
        : effect.kind === 'stun' ? 'Пропуск собственного хода' : effect.kind === 'dispel' ? `Снять ${effect.maxCount} ${effect.polarityToRemove === 'debuff' ? 'дебафа' : 'бафа'}` : effect.kind === 'shield' ? 'Щит' : effect.kind === 'periodic_damage' ? 'Периодический урон' : effect.kind === 'periodic_heal' ? 'Периодическое лечение' : effect.kind === 'damage' ? 'Урон от характеристик' : 'Лечение от характеристик'}{'durationTurns' in effect ? ` · ${typeof effect.durationTurns === 'number' ? `${effect.durationTurns} ход.` : 'срок от характеристик'}` : ''}</li>)}</ul></>
        : <p className="skill-target-note">{skill.effect === 'heal' ? 'Лечение' : 'Урон'}: {content.statDefinitions ? `×${((skillPower(skill, level || 1) + (skill.effect === 'damage' ? content.balance.attributes?.skillReferencePower ?? 8 : 0)) / (content.balance.attributes?.skillReferencePower ?? 8)).toFixed(3)} ${skill.effect === 'heal' ? 'силы лечения' : skill.element === 'physical' ? 'физической мощи' : 'магической мощи'}` : skillPower(skill, level || 1)}</p>}
      {learned && <p className="skill-target-note">Улучшение: {skill.effects?.length ? 'рост коэффициентов эффектов' : `+${progression.powerPerLevel} силы`} за {progression.pointCost} ОН.</p>}
    </details>
    <div className="skill-card-footer">
      {learned ? <button className={upgradeReasons.length ? 'ghost' : 'primary'} disabled={busy || upgradeReasons.length > 0} title={upgradeReasons.join('; ')} onClick={() => onUpgrade(skill.id, level)} aria-label={`Улучшить «${skill.name}» до ${level + 1}`}>
        {level >= progression.maxLevel ? 'Максимальный ранг' : `Улучшить · ${progression.pointCost} ОН`}</button>
        : <button className={available ? 'primary' : 'ghost'} disabled={!available || busy} title={blockers.join('; ')} onClick={() => onLearn(skill.id)} aria-label={`Изучить «${skill.name}» · ${skill.learning.pointCost} ОН`}>Изучить · {skill.learning.pointCost} ОН</button>}
      {reasons.length > 0 && <p className="skill-card-blocker">{reasons[0]}</p>}
    </div>
  </article>;
}
