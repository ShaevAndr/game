import { useState } from 'react';
import { ArenaChallenge, ArenaState, Battle, BattlefieldOptions, battlefieldOptionsSchema, DEFAULT_FIELD_SIZE } from '@game/core';
import { BattlefieldSettings } from '../../battlefield/components/BattlefieldSettings';
import '../arena.css';
import { kindNames, ruleNames } from '../../../shared/ui/game-labels';

interface Props {
  characterId: string; arena: ArenaState | null; onChallenge: (id: string) => void; onDismiss: (offer: ArenaChallenge) => void;
  rooms: Battle[]; canCreate: boolean; busy: boolean; onRefresh: () => void; onOpen: (id: string) => void;
  onCreate: (input: { name: string; kind: Battle['kind']; battlefield: BattlefieldOptions }) => void;
}

export function ArenaScreen({ characterId, arena, onChallenge, onDismiss, rooms, canCreate, busy, onRefresh, onOpen, onCreate }: Props) {
  const [battlefield, setBattlefield] = useState<BattlefieldOptions>({ size: DEFAULT_FIELD_SIZE });
  const validField = battlefieldOptionsSchema.safeParse(battlefield);
  const [name, setName] = useState('Битва стихий');
  const [kind, setKind] = useState<Battle['kind']>('duel');
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
      <p className="rule-note">Сначала перестановка и энергия. Затем — любой изученный навык и цель; совпадение школы усиливает действие. После применения или пропуска проходят каскады. Клетки защиты дополнительно усиливают защиту до следующего собственного хода.</p>
      <button className="primary" disabled={!canCreate || busy || name.trim().length < 2 || !validField.success} onClick={() => onCreate({ name, kind, battlefield })}>Создать комнату <span>↗</span></button>
    </section>
    {!!arena?.outgoing.length && <section className="panel arena-offers" aria-label="Отправленные вызовы">
      <h2>Ожидают ответа</h2><p className="hint">Можно вызвать нескольких игроков. Бой начнётся с первым принявшим; остальные предложения сбросятся.</p>
      {arena.outgoing.map(offer => <div className="arena-offer" key={offer.id}><span><strong>{offer.recipientName}</strong><small>{offer.roomName} · Вызов отправлен</small></span>
        <button className="ghost" disabled={busy} onClick={() => onDismiss(offer)}>Отозвать</button></div>)}
    </section>}
    <section className="panel rooms">
      <div className="section-label">03 / ОБЩЕЕ ЛОББИ</div>
      <div className="section-heading"><h2>Комнаты сражений</h2><button className="ghost" onClick={onRefresh}>Обновить ↻</button></div>
      {rooms.length === 0 ? <div className="empty"><span>⚑</span><h3>Первый ход за тобой</h3><p>Создай комнату и жди вызовов.<br/>Или начни бой с ботом прямо сейчас.</p></div> : rooms.map(room => {
        const own = room.fighters.some(fighter => fighter.characterId === characterId);
        const pending = arena?.outgoing.some(offer => offer.battleId === room.id);
        return <div className="arena-room" key={room.id}>
          <button className="room-row" onClick={() => onOpen(room.id)}>
            <span className="room-symbol">{room.kind === 'dungeon' ? '⬡' : '⚔'}</span>
            <span><strong>{room.name}</strong><small>{kindNames[room.kind]} · {ruleNames[room.rule]} · {room.fighters[0]?.name} · {own ? 'Твоя комната' : 'Ожидание'}</small></span><span>↗</span>
          </button>
          {room.kind === 'duel' && !own && <button className="primary" disabled={busy || !canCreate || !arena || !!arena.activeBattleId || pending}
            onClick={() => onChallenge(room.id)}>{pending ? 'Вызов отправлен' : 'Бросить вызов'}</button>}
        </div>;
      })}
    </section>
  </div>;
}
