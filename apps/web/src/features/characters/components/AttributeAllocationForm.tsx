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
    <ul className="attribute-list">{definitions.filter(definition => definition.kind === 'primary').sort((left, right) => left.displayOrder - right.displayOrder).map(definition => {
      const value = character.baseAttributes?.[definition.id] ?? 0;
      const selected = selection[definition.id] ?? 0;
      return <li key={definition.id}>
        <span title={definition.description}>{definition.name}</span>
        <div className="attribute-value"><strong className={selected ? 'has-selection' : undefined}>{value + selected}</strong>
          {points > 0 && <div className="attribute-stepper">
            <button type="button" className="ghost" aria-label={`Увеличить: ${definition.name}`} disabled={busy || remaining <= 0 || value + selected >= definition.max}
              onClick={() => setSelection(current => ({ ...current, [definition.id]: selected + 1 }))}>↑</button>
            <button type="button" className="ghost" aria-label={`Уменьшить: ${definition.name}`} disabled={busy || selected === 0}
              onClick={() => setSelection(current => ({ ...current, [definition.id]: Math.max(0, selected - 1) }))}>↓</button>
          </div>}
        </div>
      </li>;
    })}</ul>
    {spent > 0 && <div className="allocation-actions"><button className="primary" disabled={busy || remaining < 0} onClick={() => onAllocate(Object.fromEntries(Object.entries(selection).filter(([, value]) => value > 0)), character.attributeRevision ?? 0)}>Применить характеристики</button>
      <button className="ghost" disabled={busy} onClick={() => setSelection({})}>Сбросить выбор</button></div>}
  </section>;
}
