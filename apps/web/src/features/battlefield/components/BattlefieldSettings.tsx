import { BattlefieldOptions, DEFAULT_FIELD_SIZE, TileType, tileTypeNames, tileTypes, MAX_FIELD_SIDE } from '@game/core';
import '../battlefield.css';

export function BattlefieldSettings({ value, onChange, disabled }: { value: BattlefieldOptions; onChange: (value: BattlefieldOptions) => void; disabled: boolean }) {
  const size = typeof value.size === 'number' ? { rows: value.size, cols: value.size } : value.size ?? { rows: DEFAULT_FIELD_SIZE, cols: DEFAULT_FIELD_SIZE };
  const types = value.elementTypes ?? tileTypes;
  function toggle(type: TileType) {
    onChange({ ...value, elementTypes: types.includes(type) ? types.filter(element => element !== type) : [...types, type] });
  }
  return <fieldset className="battlefield-settings" disabled={disabled}>
    <legend>Боевое поле</legend>
    <div className="form-grid">
      <label>Строк<input type="number" min={1} max={MAX_FIELD_SIDE} value={Number.isFinite(size.rows) ? size.rows : ''} onChange={event => onChange({ ...value, size: { ...size, rows: event.target.valueAsNumber } })}/></label>
      <label>Столбцов<input type="number" min={1} max={MAX_FIELD_SIDE} value={Number.isFinite(size.cols) ? size.cols : ''} onChange={event => onChange({ ...value, size: { ...size, cols: event.target.valueAsNumber } })}/></label>
    </div>
    <div className="battlefield-types">{tileTypes.map(type => <label key={type}><input type="checkbox" checked={types.includes(type)} disabled={types.includes(type) && types.length <= 2} onChange={() => toggle(type)}/>{tileTypeNames[type]}</label>)}</div>
    <p className="hint">Не меньше двух типов элементов. По умолчанию доступны четыре стихии, физический тип и защита.</p>
  </fieldset>;
}
