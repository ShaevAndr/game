import { Character, Content, Skill, elementNames, elements, learningBlockers, learningStatRequirements, skillLevel, skillPower, skillProgression, upgradeBlockers } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';
import { targetingLabels } from '../../../shared/ui/effect-labels';
import '../../battles/effects.css';

interface Props { character?: Character; content: Content | null; busy: boolean; onLearn: (id: string) => void; onUpgrade: (id: string, expectedLevel: number) => void }
export function SkillTree({ character, content, busy, onLearn, onUpgrade }: Props) {
  if (!content) return <section className="panel"><h2>Дерево навыков</h2><p>Загрузка каталога навыков…</p></section>;
  const skills = content.skills;
  const depth = (skill: Skill): number => skill.learning.prerequisites.length ? 1 + Math.max(...skill.learning.prerequisites.map(id => { const parent = skills.find(s => s.id === id); return parent ? depth(parent) : -1; })) : 0;
  return <section className="panel skill-tree-screen">
    <div className="section-label">РАЗВИТИЕ ПЕРСОНАЖА</div>
    <div className="section-heading"><div><h2>Пять путей мастерства</h2><p>{character ? `${character.name} · уровень ${character.level}` : 'Выбери персонажа, чтобы изучать навыки.'}</p></div><div className="points-badge"><strong>{character?.skillPoints ?? '—'}</strong><span>ОЧКОВ НАВЫКОВ</span></div></div>
    <p className="tree-help">Изучи предыдущие навыки ветки, достигни нужного уровня и характеристик. Каждое повышение уровня даёт {content.balance.progression.skillPointsPerLevel} очка навыков. Новые навыки и характеристики применяются при старте боя. Уже начатые бои сохраняют свой набор.</p>
    <div className="skill-branches">{elements.map(element => <section className="skill-branch" key={element} aria-label={`Ветка: ${elementNames[element]}`}>
      <div className="branch-title"><span className={`element-icon ${element}`}>{symbols[element]}</span><h3>{elementNames[element]}</h3></div>
      <div className="branch-heroes"><div className="section-label">ГЕРОИ ВЕТКИ</div>{content.characterTemplates.filter(t => t.element === element).map(template => <p key={template.id}><strong>{template.name}</strong><span>Рекомендуемый навык: {skills.find(s => s.id === template.skillId)?.name}</span></p>)}</div>
      {skills.filter(s => s.element === element).sort((a, b) => depth(a) - depth(b) || a.learning.level - b.learning.level || a.id.localeCompare(b.id)).map(skill => {
        const level = character ? skillLevel(character, skill.id) : 0;
        const learned = level > 0;
        const progression = skillProgression(skill);
        const upgradeReasons = character ? upgradeBlockers(character, skill) : ['Выберите персонажа'];
        const blockers = character ? learningBlockers(character, skill, skills, content?.statDefinitions) : ['Выберите персонажа'];
        const available = !!character && !learned && blockers.length === 0;
        const r = skill.learning;
        return <article key={skill.id} className={`skill-node ${learned ? 'learned' : available ? 'available' : 'locked'}`}>
          <div className="node-status">{learned ? `✓ УРОВЕНЬ ${level} / ${progression.maxLevel}` : available ? 'МОЖНО ИЗУЧИТЬ' : 'ЗАКРЫТ'}</div>
          <h4>{skill.name}</h4><p className="node-description">{skill.description}</p>
          {skill.effects?.length ? <><div className="node-effect">{targetingLabels[skill.targeting!.kind]} · Энергия: {skill.cost}<br/>Перезарядка: {skill.cooldown} ход.</div>
            <ul className="skill-effects-list">{skill.effects.map(effect => <li key={effect.id}>{effect.kind === 'stat_modifier' ? `${effect.polarity === 'buff' ? 'Усиление' : 'Ослабление'}: ${content.statDefinitions?.find(definition => definition.id === effect.statId)?.name ?? effect.statId} · ${typeof effect.durationTurns === 'number' ? `${effect.durationTurns} ход.` : 'срок от характеристик'}` : effect.kind === 'dispel' ? `Снять ${effect.maxCount} ${effect.polarityToRemove === 'debuff' ? 'дебаф' : 'баф'}` : effect.kind === 'damage' ? 'Урон от характеристик' : 'Лечение от характеристик'}</li>)}</ul></>
            : <div className="node-effect">{skill.effect === 'heal' ? 'Лечение' : 'Урон'}: {content.statDefinitions ? `×${((skillPower(skill, level || 1) + (skill.effect === 'damage' ? content.balance.attributes?.skillReferencePower ?? 8 : 0)) / (content.balance.attributes?.skillReferencePower ?? 8)).toFixed(3)} ${skill.effect === 'heal' ? 'силы лечения' : skill.element === 'physical' ? 'физической мощи' : 'магической мощи'}` : skillPower(skill, level || 1)} · Энергия: {skill.cost}<br/>Перезарядка: {skill.cooldown} ход.</div>}
          {r.starter ? <p className="starter-note">Бесплатный стартовый навык</p> : <ul className="skill-requirements">
            <li className={character && character.skillPoints >= r.pointCost ? 'met' : ''}>{r.pointCost} очк. навыков{character ? ` · есть ${character.skillPoints}` : ''}</li>
            <li className={character && character.level >= r.level ? 'met' : ''}>Уровень {r.level}</li>
            {r.prerequisites.map(id => <li key={id} className={character?.learnedSkillIds.includes(id) ? 'met' : ''}>Навык «{skills.find(s => s.id === id)?.name ?? id}»</li>)}
            {character && learningStatRequirements(character, skill, content?.statDefinitions).map((requirement, index) => <li key={`${requirement.id}:${index}`} className={requirement.actual >= requirement.required ? 'met' : ''}>{requirement.name} ≥ {requirement.required} · есть {requirement.actual}</li>)}
          </ul>}
          {learned ? <>
            <p className="hint">{skill.effects?.length ? `Улучшение коэффициентов эффектов за ${progression.pointCost} ОН.` : `Улучшение: +${progression.powerPerLevel} силы за ${progression.pointCost} ОН.`}</p>
            <button className={upgradeReasons.length ? 'ghost' : 'primary'} disabled={busy || upgradeReasons.length > 0} title={upgradeReasons.join('; ')} onClick={() => onUpgrade(skill.id, level)}>{level >= progression.maxLevel ? 'Максимальный уровень' : `Улучшить до ${level + 1} · ${progression.pointCost} ОН`}</button>
          </> : <button className={available ? 'primary' : 'ghost'} disabled={!available || busy} title={blockers.join('; ')} onClick={() => onLearn(skill.id)}>{available ? `Изучить · ${r.pointCost} ОН` : 'Недоступен'}</button>}
        </article>;
      })}
    </section>)}</div>
  </section>;
}
