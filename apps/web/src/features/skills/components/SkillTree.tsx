import { useMemo, useState } from 'react';
import type { Element } from '@game/core';
import type { SkillTreeProps } from '../model/skill-tree';
import { skillSchools } from '../model/skill-schools';
import { SkillEmblem } from './SkillEmblem';
import { SkillSchoolTabs } from './SkillSchoolTabs';
import { SkillGraph } from './SkillGraph';
import '../../battles/effects.css';
import '../skill-tree.css';

export function SkillTree({ character, content, busy, onLearn, onUpgrade }: SkillTreeProps) {
  const [element, setElement] = useState<Element>('fire');
  const learnedIds = useMemo(() => character?.learnedSkillIds ?? [], [character?.learnedSkillIds]);
  if (!content) return <section className="panel"><h2>Дерево навыков</h2><p>Загрузка каталога навыков…</p></section>;
  const current = skillSchools[element], skills = content.skills.filter(skill => skill.element === element);
  const learned = skills.filter(skill => learnedIds.includes(skill.id)).length;
  return <section className="panel skill-tree-screen skill-grimoire">
    <header className="grimoire-heading"><div><h2>Навыки</h2><p>{character ? `${character.name} · уровень ${character.level}` : 'Выбери персонажа, чтобы изучать навыки.'}</p></div>
      <div className="points-badge" role="status"><strong>{character?.skillPoints ?? '—'}</strong><span>ОЧКОВ НАВЫКОВ</span></div>
    </header>
    <SkillSchoolTabs content={content} element={element} learnedIds={learnedIds} onElement={setElement}/>
    <section role="tabpanel" id={`school-panel-${element}`} aria-labelledby={`school-tab-${element}`} tabIndex={0} className={`skill-school-panel school-${element}`}>
      <div className="school-introduction"><SkillEmblem element={element} icon={current.icon}/><div><h3>{current.title}</h3><p>{current.motto}</p></div><div className="school-mastery"><b>{learned}<span> / {skills.length}</span></b><small>навыков изучено</small></div></div>
      <div className="tree-rule"><span aria-hidden="true">◇</span><p>Изучи <strong>любой один навык</strong> предыдущего узла, чтобы открыть следующий. Соседние навыки можно выбирать независимо. Уровень героя, характеристики и очки также учитываются.</p></div>
      {character && learnedIds.length === 0 && <p className="grimoire-empty-note">Начни с верхнего узла. Все пять школ открыты для изучения; выбирать только одну не обязательно.</p>}
      <div className="tree-state-key"><span><i className="key-learned"/>Изучено</span><span><i className="key-available"/>Можно изучить</span><span><i className="key-locked"/>Нужны требования</span></div>
      <SkillGraph character={character} content={content} busy={busy} onLearn={onLearn} onUpgrade={onUpgrade}
        element={element} learnedIds={learnedIds}/>
      <p className="grimoire-footnote">Изучение и улучшение тратят очки навыков. Энергия расходуется только в бою. Уже начатый бой сохраняет свой набор умений.</p>
    </section>
  </section>;
}
