import { useState } from 'react';
import { Content, elementNames, elements } from '@game/core';

interface Props { content: Content | null; busy: boolean; onCreate: (name: string, templateId?: string) => Promise<boolean> }
export function CharacterCreation({ content, busy, onCreate }: Props) {
  const [name, setName] = useState(''), [templateId, setTemplateId] = useState('');
  const template = content?.characterTemplates.find(t => t.id === templateId);
  const skill = content?.skills.find(s => s.id === template?.skillId);
  return <form className="character-form" onSubmit={e => { e.preventDefault(); void onCreate(name, templateId || undefined).then(created => { if (created) setName(''); }); }}>
    <label>Тип нового героя<select value={templateId} onChange={e => setTemplateId(e.target.value)} disabled={busy || !content}>
      <option value="">Странник · свободный выбор</option>
      {elements.map(element => <optgroup key={element} label={elementNames[element]}>{content?.characterTemplates.filter(t => t.element === element).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
    </select></label>
    <p className="hint">{template ? `${template.description} Начальный навык стоит ${skill?.learning.pointCost ?? '—'} ОН; остаток: ${content ? content.balance.progression.startingSkillPoints - (skill?.learning.pointCost ?? 0) : '—'}.` : `Начинает с «Удара» и ${content?.balance.progression.startingSkillPoints ?? '—'} ОН. Можно развивать любую ветку.`}</p>
    <div className="inline-form"><input placeholder="Имя нового героя" aria-label="Имя нового героя" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={24} required disabled={busy}/><button className="square" disabled={busy || !content || name.trim().length < 2} title="Создать персонажа" aria-label="Создать персонажа">+</button></div>
  </form>;
}
