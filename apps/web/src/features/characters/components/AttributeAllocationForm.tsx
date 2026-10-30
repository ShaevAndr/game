import { useState } from 'react';
import { Character, StatDefinition } from '@game/core';
import '../attributes.css';

interface Props { character: Character; definitions: StatDefinition[]; busy: boolean; onAllocate: (allocations: Record<string, number>, expectedRevision: number) => void }
export function AttributeAllocationForm({ character, definitions, busy, onAllocate }: Props) {
  const [selection, setSelection] = useState<Record<string, number>>({});
  const spent = Object.values(selection).reduce((sum, value) => sum + value, 0);
  const points = character.attributePoints ?? 0;
  const remaining = points - spent;
  return <section className="attribute-allocation" aria-label="Распределение характеристик">
    <div className="section-heading"><h3>Первичные характеристики</h3><strong role="status">Свободно очков: {remaining}</strong></div>
    <p className="hint">За каждый уровень — 5 очков для распределения. Повышение уровня само по себе характеристики не увеличивает.</p>
    <div className="attribute-inputs">{definitions.filter(definition => definition.kind === 'primary').sort((left, right) => left.displayOrder - right.displayOrder).map(definition => {
      const value = character.baseAttributes?.[definition.id] ?? 0;
      const selected = selection[definition.id] ?? 0;
      return <label key={definition.id} title={definition.description}><span>{definition.name} <b>{value}{selected ? ` → ${value + selected}` : ''}</b></span>
        <input type="number" min={0} step={1} max={Math.min(definition.max - value, remaining + selected)} value={selected} disabled={busy || points === 0}
          aria-label={`Добавить очки: ${definition.name}`} onChange={event => {
            const quantity = Math.max(0, Math.min(definition.max - value, remaining + selected, Math.floor(Number(event.target.value) || 0)));
            setSelection(current => ({ ...current, [definition.id]: quantity }));
          }}/></label>;
    })}</div>
    <div className="allocation-actions"><button className="primary" disabled={busy || spent === 0 || remaining < 0} onClick={() => onAllocate(Object.fromEntries(Object.entries(selection).filter(([, value]) => value > 0)), character.attributeRevision ?? 0)}>Применить характеристики</button>
      {spent > 0 && <button className="ghost" disabled={busy} onClick={() => setSelection({})}>Сбросить выбор</button>}</div>
  </section>;
}
