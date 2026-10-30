import { AttributeCalculation, StatDefinition } from '@game/core';
import '../attributes.css';

interface Props { attributes: AttributeCalculation; definitions: StatDefinition[] }
export function CharacterAttributes({ attributes, definitions }: Props) {
  const display = (value: number, definition: StatDefinition, signed = false) => {
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${definition.unit === 'basis_points' ? `${value / 100}%` : value}`;
  };
  return <section className="character-attributes" aria-label="Расчёт параметров персонажа">
    <h3>Параметры персонажа</h3>
    <p className="hint">База → экипировка → временные эффекты. В таблице показан вклад каждого этапа.</p>
    <div className="attribute-table-scroll"><table className="attribute-table"><thead><tr><th scope="col">Параметр</th><th scope="col">База</th><th scope="col">Экипировка</th><th scope="col">Эффекты</th><th scope="col">Итог</th></tr></thead>
      <tbody>{definitions.filter(definition => definition.visible).sort((left, right) => left.displayOrder - right.displayOrder).map(definition => {
        const values = attributes.breakdown[definition.id];
        if (!values) return null;
        return <tr key={definition.id} className={definition.kind === 'primary' ? 'primary-attribute' : ''}><th scope="row" title={definition.description}>{definition.name}</th><td>{display(values.base, definition)}</td><td>{display(values.equipped - values.base, definition, true)}</td><td>{display(values.effective - values.equipped, definition, true)}</td><td><strong>{display(values.effective, definition)}</strong></td></tr>;
      })}</tbody></table></div>
    <p className="hint">Защита уменьшает урон соответствующего типа. Лимит общей энергии — 30.</p>
  </section>;
}
