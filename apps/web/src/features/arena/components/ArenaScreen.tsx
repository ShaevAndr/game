import { useState } from 'react';
import { Battle, Rule } from '@game/core';
import { kindNames, ruleNames } from '../../../shared/ui/game-labels';

interface Props {
  rooms: Battle[]; canCreate: boolean; busy: boolean; onRefresh: () => void; onOpen: (id: string) => void;
  onCreate: (input: { name: string; kind: Battle['kind']; rule: Rule }) => void;
}

export function ArenaScreen({ rooms, canCreate, busy, onRefresh, onOpen, onCreate }: Props) {
  const [name, setName] = useState('Битва стихий');
  const [kind, setKind] = useState<Battle['kind']>('bot');
  const [rule, setRule] = useState<Rule>('before-after');
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
        <label>Правила применения навыков<select value={rule} onChange={event => setRule(event.target.value as Rule)}>
          {Object.entries(ruleNames).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select></label>
      </div>
      <p className="rule-note">{rule === 'before' ? 'Один навык до перестановки. Собранные фишки наносят урон, затем ход переходит сопернику.' : rule === 'before-after' ? 'Один навык за ход: до или после перестановки. Урон от фишек — сразу. Заверши ход кнопкой.' : 'Сначала собери фишки, затем обязательно выбери навык. Количество фишек усиливает его действие.'}</p>
      <button className="primary" disabled={!canCreate || busy || name.trim().length < 2} onClick={() => onCreate({ name, kind, rule })}>Создать комнату <span>↗</span></button>
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
