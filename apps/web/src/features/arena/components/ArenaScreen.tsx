import { useState } from 'react';
import { Battle, BattlefieldOptions, battlefieldOptionsSchema, DEFAULT_FIELD_SIZE } from '@game/core';
import { BattlefieldSettings } from '../../battlefield/components/BattlefieldSettings';
import { kindNames, ruleNames } from '../../../shared/ui/game-labels';

interface Props {
  rooms: Battle[]; canCreate: boolean; busy: boolean; onRefresh: () => void; onOpen: (id: string) => void;
  onCreate: (input: { name: string; kind: Battle['kind']; battlefield: BattlefieldOptions }) => void;
}

export function ArenaScreen({ rooms, canCreate, busy, onRefresh, onOpen, onCreate }: Props) {
  const [battlefield, setBattlefield] = useState<BattlefieldOptions>({ size: DEFAULT_FIELD_SIZE });
  const validField = battlefieldOptionsSchema.safeParse(battlefield);
  const [name, setName] = useState('Битва стихий');
  const [kind, setKind] = useState<Battle['kind']>('bot');
  return <div className="main-column">
    <section className="panel create-room">
      <div className="section-label">02 / НАЧНИ НОВОЕ СРАЖЕНИЕ</div><h2>Собери свою тактику</h2>
      <div className="mode-tabs">{(['bot', 'duel', 'team', 'dungeon'] as const).map(value =>
        <button className={kind === value ? 'chosen' : ''} onClick={() => setKind(value)} key={value}>
          <span>{value === 'bot' ? '◈' : value === 'duel' ? '⚔' : value === 'team' ? '⚑' : '⬡'}</span>{kindNames[value]}
          <small>{value === 'bot' ? '1 на 1 · компьютер' : value === 'duel' ? '1 на 1' : value === 'team' ? 'до 3 на 3' : '1–3 игрока · 3 волны'}</small>
        </button>)}
      </div>
      <div className="form-grid">
        <label>Название комнаты<input value={name} onChange={event => setName(event.target.value)} maxLength={48}/></label>

      </div>
      <BattlefieldSettings value={battlefield} onChange={setBattlefield} disabled={busy}/>
      {!validField.success && <p className="hint" role="status">{validField.error.issues.map(issue => issue.message).join('; ')}</p>}
      <p className="rule-note">Сначала поле и все каскады. Затем — навык типа прямого совпадения с расходом энергии. Защита усиливает героя на ход противника; вторичные совпадения только копят энергию.</p>
      <button className="primary" disabled={!canCreate || busy || name.trim().length < 2 || !validField.success} onClick={() => onCreate({ name, kind, battlefield })}>Создать комнату <span>↗</span></button>
    </section>
    <section className="panel rooms">
      <div className="section-label">03 / ОБЩЕЕ ЛОББИ</div>
      <div className="section-heading"><h2>Комнаты сражений</h2><button className="ghost" onClick={onRefresh}>Обновить ↻</button></div>
      {rooms.length === 0 ? <div className="empty"><span>⚑</span><h3>Первый ход за тобой</h3><p>Создай комнату и пригласи соперника.<br/>Или начни бой с ботом прямо сейчас.</p></div> : rooms.map(room =>
        <button className="room-row" key={room.id} onClick={() => onOpen(room.id)}>
          <span className="room-symbol">{room.kind === 'dungeon' ? '⬡' : '⚔'}</span>
          <span><strong>{room.name}</strong><small>{kindNames[room.kind]} · {ruleNames[room.rule]} · {room.fighters.filter(fighter => !fighter.npc).length} игроков</small></span>
          <span className={`status ${room.status}`}>{room.status === 'waiting' ? 'Ожидание' : room.status === 'active' ? 'В бою' : 'Завершён'}</span><span>↗</span>
        </button>)}
    </section>
  </div>;
}
