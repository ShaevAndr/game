import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { elements, elementNames, skillTreeNodes, type Character, type Content, type Element, type SkillTreeNode } from '@game/core';
import { SkillEmblem } from './SkillEmblem';
import { SkillCard } from './SkillCard';
import { useSkillConnections } from '../model/useSkillConnections';
import '../../battles/effects.css';
import '../skill-tree.css';

interface Props { character?: Character; content: Content | null; busy: boolean; onLearn: (id: string) => void; onUpgrade: (id: string, expectedLevel: number) => void }
const schools: Record<Element, { title: string; motto: string; icon: Parameters<typeof SkillEmblem>[0]['icon'] }> = {
  fire: { title: 'Огонь', motto: 'Покори пламя. Выбери разрушение или силу феникса.', icon: 'flame' },
  water: { title: 'Вода', motto: 'Сковывай врагов льдом или возвращай союзникам силы.', icon: 'drop' },
  earth: { title: 'Земля', motto: 'Пробуди гнев гор и несокрушимую силу живых корней.', icon: 'mountain' },
  air: { title: 'Воздух', motto: 'Призови бурю или обрати ветер в защиту союзников.', icon: 'wind' },
  physical: { title: 'Физические', motto: 'От основ оружия — к натиску, стойкости и хитрости.', icon: 'sword' },
};

export function SkillTree({ character, content, busy, onLearn, onUpgrade }: Props) {
  const [element, setElement] = useState<Element>('fire');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const learnedIds = useMemo(() => character?.learnedSkillIds ?? [], [character?.learnedSkillIds]);
  const nodes = useMemo(() => {
    if (!content) return [];
    const grouped = skillTreeNodes(content.skills).filter(node => node.element === element);
    // Custom skills without group metadata still show their actual mandatory dependencies.
    const ungrouped = content.skills.filter(skill => skill.element === element && !skill.learning.branch).map((skill, i): SkillTreeNode => ({
      id: `single-${skill.id}`, name: skill.name, element, order: 100 + i, skills: [skill],
      parents: skill.learning.prerequisites.map(id => content.skills.find(skill => skill.id === id)?.learning.branch?.id ?? `single-${id}`),
    }));
    return [...grouped, ...ungrouped];
  }, [content, element]);
  const { ref: graph, drawing } = useSkillConnections(nodes, learnedIds, element);
  const { rows, lanes } = useMemo(() => {
    const depths = new Map<string, number>();
    const depth = (node: SkillTreeNode): number => {
      if (depths.has(node.id)) return depths.get(node.id)!;
      const parents = nodes.filter(parent => node.parents.includes(parent.id));
      const result = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
      depths.set(node.id, result); return result;
    };
    for (const node of nodes) depth(node);
    const forks = nodes.filter(node => depths.get(node.id) === 1);
    const lane = (node: SkillTreeNode): number => {
      if (forks.some(fork => fork.id === node.id)) return forks.findIndex(fork => fork.id === node.id) + 1;
      const parent = nodes.find(parent => node.parents.includes(parent.id));
      return parent ? lane(parent) : 0;
    };
    return { rows: [...new Set(depths.values())].sort((a, b) => a - b).map(value => nodes.filter(node => depths.get(node.id) === value)), lanes: new Map(nodes.map(node => [node.id, lane(node)])) };
  }, [nodes]);
  if (!content) return <section className="panel"><h2>Дерево навыков</h2><p>Загрузка каталога навыков…</p></section>;
  const current = schools[element], skills = content.skills.filter(skill => skill.element === element);
  const learned = skills.filter(skill => learnedIds.includes(skill.id)).length;
  const keyboard = (event: KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % elements.length : event.key === 'ArrowLeft' ? (index + elements.length - 1) % elements.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? elements.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); setElement(elements[next]); tabs.current[next]?.focus();
  };
  return <section className="panel skill-tree-screen skill-grimoire">
    <header className="grimoire-heading"><div><div className="section-label">ГРИМУАР МАСТЕРСТВА</div><h2>Выбери свой путь</h2><p>{character ? `${character.name} · уровень ${character.level}` : 'Выбери персонажа, чтобы изучать навыки.'}</p></div>
      <div className="points-badge" role="status"><strong>{character?.skillPoints ?? '—'}</strong><span>ОЧКОВ НАВЫКОВ</span></div>
    </header>
    <div className="skill-school-tabs" role="tablist" aria-label="Школы навыков">{elements.map((school, index) => {
      const list = content.skills.filter(skill => skill.element === school);
      return <button key={school} ref={node => { tabs.current[index] = node; }} role="tab" id={`school-tab-${school}`} aria-selected={element === school}
        aria-controls={`school-panel-${school}`} tabIndex={element === school ? 0 : -1} className={`school-tab school-${school}`} onClick={() => setElement(school)} onKeyDown={event => keyboard(event, index)}>
        <SkillEmblem element={school} icon={schools[school].icon} small/><span>{schools[school].title}<small>{list.filter(skill => learnedIds.includes(skill.id)).length} / {list.length}</small></span>
      </button>;
    })}</div>
    <section role="tabpanel" id={`school-panel-${element}`} aria-labelledby={`school-tab-${element}`} tabIndex={0} className={`skill-school-panel school-${element}`}>
      <div className="school-introduction"><SkillEmblem element={element} icon={current.icon}/><div><span className="section-label">ПУТЬ {element === 'physical' ? 'МАСТЕРА ОРУЖИЯ' : elementNames[element].toUpperCase()}</span><h3>{current.title}</h3><p>{current.motto}</p></div><div className="school-mastery"><b>{learned}<span> / {skills.length}</span></b><small>навыков изучено</small></div></div>
      <div className="tree-rule"><span aria-hidden="true">◇</span><p>Изучи <strong>любой один навык</strong> предыдущего узла, чтобы открыть следующий. Соседние навыки можно выбирать независимо. Уровень героя, характеристики и очки также учитываются.</p></div>
      {character && learnedIds.length === 0 && <p className="grimoire-empty-note">Начни с верхнего узла. Все пять школ открыты для изучения; выбирать только одну не обязательно.</p>}
      <div className="tree-state-key"><span><i className="key-learned"/>Изучено</span><span><i className="key-available"/>Можно изучить</span><span><i className="key-locked"/>Нужны требования</span></div>
      <div className="skill-graph skill-branches" ref={graph}>
        <svg className="skill-tree-connections" width={drawing.width} height={drawing.height} aria-hidden="true">
          {drawing.edges.map(edge => <path key={edge.id} d={edge.path} className={edge.open ? 'connection-open' : ''}/>)}
        </svg>
        {rows.map((row, index) => <div className={`skill-tree-stage${index === 0 ? ' tree-roots' : ''}`} key={index}>
          {row.map(node => {
            const mastered = node.skills.some(skill => learnedIds.includes(skill.id));
            const open = node.parents.every(id => nodes.find(parent => parent.id === id)?.skills.some(skill => learnedIds.includes(skill.id)));
            return <section className={`skill-tree-node ${mastered ? 'node-mastered' : open ? 'node-open' : 'node-locked'}`} key={node.id} data-branch-id={node.id} data-lane={lanes.get(node.id) || undefined} aria-labelledby={`branch-${node.id}`}>
              <header className="branch-node-heading"><div><span className="branch-step">{index === 0 ? 'ИСТОК' : `СТУПЕНЬ ${index + 1}`}</span><h4 id={`branch-${node.id}`}>{node.name}</h4></div><span className="branch-node-state">{mastered ? '✓ Освоен' : open ? '◇ Открыт' : '◈ Закрыт'}</span></header>
              <p className="branch-node-requirement">{!node.parents.length ? 'Начни с любого навыка этого узла' : `Любой навык: ${node.parents.map(id => nodes.find(parent => parent.id === id)?.name ?? id).join(' + ')}`}</p>
              <div className="branch-skill-cards">{node.skills.map(skill => <SkillCard key={skill.id} skill={skill} content={content} character={character} busy={busy} onLearn={onLearn} onUpgrade={onUpgrade}/>)}</div>
            </section>;
          })}
        </div>)}
      </div>
      {!nodes.length && <p className="empty">В этой школе пока нет навыков.</p>}
      <p className="grimoire-footnote">Изучение и улучшение тратят очки навыков. Энергия расходуется только в бою. Уже начатый бой сохраняет свой набор умений.</p>
    </section>
  </section>;
}
