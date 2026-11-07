import { BattlefieldOptions, DEFAULT_FIELD_SIZE, MAX_FIELD_SIDE } from '@game/core';
import '../battlefield.css';

export function BattlefieldSettings({ value, onChange, disabled }: { value: BattlefieldOptions; onChange: (value: BattlefieldOptions) => void; disabled: boolean }) {
  const size = typeof value.size === 'number' ? { rows: value.size, cols: value.size } : value.size ?? { rows: DEFAULT_FIELD_SIZE, cols: DEFAULT_FIELD_SIZE };
  return <fieldset className="battlefield-settings" disabled={disabled}>
    <legend>Боевое поле</legend>
    <div className="form-grid">
      <label>Строк<input type="number" min={1} max={MAX_FIELD_SIDE} value={Number.isFinite(size.rows) ? size.rows : ''} onChange={event => onChange({ ...value, size: { ...size, rows: event.target.valueAsNumber } })}/></label>
      <label>Столбцов<input type="number" min={1} max={MAX_FIELD_SIDE} value={Number.isFinite(size.cols) ? size.cols : ''} onChange={event => onChange({ ...value, size: { ...size, cols: event.target.valueAsNumber } })}/></label>
    </div>
    <p className="hint">Четыре стихии, физический тип и защита. Можно изменить количество строк и столбцов.</p>
  </fieldset>;
}
