import { useRef, type KeyboardEvent } from 'react';
import { elements, type Content, type Element } from '@game/core';
import { skillSchools } from '../model/skill-schools';
import { SkillEmblem } from './SkillEmblem';

interface Props {
  content: Content;
  element: Element;
  learnedIds: string[];
  onElement: (element: Element) => void;
}

export function SkillSchoolTabs({ content, element, learnedIds, onElement }: Props) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const keyboard = (event: KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % elements.length : event.key === 'ArrowLeft' ? (index + elements.length - 1) % elements.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? elements.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); onElement(elements[next]); tabs.current[next]?.focus();
  };
  return <div className="skill-school-tabs" role="tablist" aria-label="Школы навыков">{elements.map((school, index) => {
      const list = content.skills.filter(skill => skill.element === school);
      return <button key={school} ref={node => { tabs.current[index] = node; }} role="tab" id={`school-tab-${school}`} aria-selected={element === school}
        aria-controls={`school-panel-${school}`} tabIndex={element === school ? 0 : -1} className={`school-tab school-${school}`} onClick={() => onElement(school)} onKeyDown={event => keyboard(event, index)}>
        <SkillEmblem element={school} icon={skillSchools[school].icon} small/><span>{skillSchools[school].title}<small>{list.filter(skill => learnedIds.includes(skill.id)).length} / {list.length}</small></span>
      </button>;
    })}</div>;
}
