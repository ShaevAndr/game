import { useState } from 'react';
import { battlefieldOptionsSchema, DEFAULT_FIELD_SIZE, type Battle, type BattlefieldOptions } from '@game/core';
import { BattlefieldSettings } from '../../battlefield/components/BattlefieldSettings';
import { kindNames } from '../../../shared/ui/game-labels';

export interface CreateRoomInput { name: string; kind: Battle['kind']; battlefield: BattlefieldOptions }
interface Props {
  open: boolean;
  busy: boolean;
  canCreate: boolean;
  onCreate: (input: CreateRoomInput) => Promise<boolean>;
  onCreated: () => void;
}

export function CreateRoomForm({ open, busy, canCreate, onCreate, onCreated }: Props) {
  const [battlefield, setBattlefield] = useState<BattlefieldOptions>({ size: DEFAULT_FIELD_SIZE });
  const validField = battlefieldOptionsSchema.safeParse(battlefield);
  const [name, setName] = useState('Битва стихий');
  const [kind, setKind] = useState<Battle['kind']>('duel');
  if (!open) return null;
  return <form id="create-room" className="create-room" onSubmit={event => {
      event.preventDefault();
      if (busy || !canCreate || name.trim().length < 2 || !validField.success) return;
      void onCreate({ name: name.trim(), kind, battlefield }).then(created => { if (created) onCreated(); });
    }}>
      <h3>Новая комната</h3>
      <div className="mode-tabs" aria-label="Режим боя">{(['duel', 'bot', 'team', 'dungeon'] as const).map(value =>
        <button type="button" aria-pressed={kind === value} disabled={busy} className={kind === value ? 'chosen' : ''} onClick={() => setKind(value)} key={value}>
          {kindNames[value]}<small>{value === 'bot' ? '1 на 1 · компьютер' : value === 'duel' ? '1 на 1' : value === 'team' ? 'до 3 на 3' : '1–3 игрока · 3 волны'}</small>
        </button>)}
      </div>
      <label>Название комнаты<input value={name} disabled={busy} onChange={event => setName(event.target.value)} minLength={2} maxLength={48} required/></label>
      <details className="arena-field-settings"><summary>Настройки поля</summary><BattlefieldSettings value={battlefield} onChange={setBattlefield} disabled={busy}/></details>
      {!validField.success && <p className="hint" role="status">{validField.error.issues.map(issue => issue.message).join('; ')}</p>}
      <button className="primary" disabled={!canCreate || busy || name.trim().length < 2 || !validField.success}>Создать</button>
    </form>;
}
