import { useState } from 'react';
import { learningBlockers, skillLevel, type Element } from '@game/core';
import type { SkillTreeProps } from '../model/skill-tree';
import { useSkillTreeLayout } from '../model/useSkillTreeLayout';
import { useSkillConnections } from '../model/useSkillConnections';
import { SkillCard } from './SkillCard';
import { SkillEmblem } from './SkillEmblem';

interface Props extends SkillTreeProps {
  element: Element;
  learnedIds: string[];
}

export function SkillGraph({ character, content, busy, onLearn, onUpgrade, element, learnedIds }: Props) {
  const { nodes, rows } = useSkillTreeLayout(content, element);
  const { ref: graph, drawing } = useSkillConnections(nodes, learnedIds, element);
  const [selectedId, setSelectedId] = useState<string>();
  const skills = nodes.flatMap(node => node.skills);
  const selected = skills.find(skill => skill.id === selectedId) ?? skills[0];
  if (!content) return null;
  if (!selected) return <p className="empty">В этой школе пока нет навыков.</p>;
  return <div className="skill-study-layout">
    <div className="skill-map-scroll" role="region" aria-label="Карта навыков — прокрутка по горизонтали" tabIndex={0}>
      <div className="skill-map-caption"><span>ПУТЬ МАСТЕРСТВА</span><span>Выбери печать навыка</span></div>
      <div className="skill-graph skill-branches" ref={graph}>
        <svg className="skill-tree-connections" width={drawing.width} height={drawing.height} aria-hidden="true">
          {drawing.edges.map(edge => <path key={edge.id} d={edge.path} className={edge.open ? 'connection-open' : ''}/>)}
        </svg>
        {rows.map((row, index) => <div className="skill-tree-stage" key={index}>
          <span className="skill-stage-label">{index === 0 ? 'ИСТОК' : `СТУПЕНЬ ${index + 1}`}</span>
          {row.map(node => <section className="skill-map-branch" key={node.id} data-branch-id={node.id} aria-label={node.name}>
            <h4>{node.name}</h4>
            <div className="skill-map-seals">{node.skills.map(skill => {
              const level = character ? skillLevel(character, skill.id) : 0;
              const available = !!character && learningBlockers(character, skill, content.skills, content.statDefinitions).length === 0;
              const state = level ? 'learned' : available ? 'available' : 'locked';
              return <button type="button" key={skill.id} className={`skill-seal ${state}${selected.id === skill.id ? ' selected' : ''}`}
                data-skill-seal={skill.id} aria-pressed={selected.id === skill.id} aria-controls="selected-skill-details"
                aria-label={`${skill.name} · ${level ? `Изучено, ранг ${level}` : available ? 'Можно изучить' : 'Нужны требования'}`}
                onClick={() => setSelectedId(skill.id)}>
                <span className="skill-seal-icon"><SkillEmblem element={element} icon={skill.icon ?? (skill.effect === 'heal' ? 'heart' : 'spark')}/><span className="skill-seal-rank">{level ? `✓ ${level}` : `${skill.learning.pointCost} ОН`}</span></span>
                <span className="skill-seal-name">{skill.name}</span>
              </button>;
            })}</div>
          </section>)}
        </div>)}
      </div>
    </div>
    <aside className="skill-inspector" id="selected-skill-details" aria-label="Выбранный навык">
      <div className="skill-inspector-label">ЗНАНИЯ ШКОЛЫ <span aria-hidden="true">✧</span></div>
      <SkillCard key={selected.id} skill={selected} content={content} character={character} busy={busy} onLearn={onLearn} onUpgrade={onUpgrade}/>
    </aside>
  </div>;
}
