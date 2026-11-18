import type { Element } from '@game/core';
import type { SkillTreeProps } from '../model/skill-tree';
import { useSkillTreeLayout } from '../model/useSkillTreeLayout';
import { useSkillConnections } from '../model/useSkillConnections';
import { SkillCard } from './SkillCard';

interface Props extends SkillTreeProps {
  element: Element;
  learnedIds: string[];
}

export function SkillGraph({ character, content, busy, onLearn, onUpgrade, element, learnedIds }: Props) {
  const { nodes, rows, lanes } = useSkillTreeLayout(content, element);
  const { ref: graph, drawing } = useSkillConnections(nodes, learnedIds, element);
  if (!content) return null;
  return <>
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
  </>;
}
