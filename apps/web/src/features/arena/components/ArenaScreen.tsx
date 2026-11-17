import { useState } from 'react';
import { ArenaChallenge, ArenaState, Battle, BattlefieldOptions, battlefieldOptionsSchema, DEFAULT_FIELD_SIZE } from '@game/core';
import { BattlefieldSettings } from '../../battlefield/components/BattlefieldSettings';
import '../arena.css';
import { kindNames } from '../../../shared/ui/game-labels';

interface Props {
  characterId: string; arena: ArenaState | null; onChallenge: (id: string) => void; onDismiss: (offer: ArenaChallenge) => void; onAccept: (offer: ArenaChallenge) => void;
  rooms: Battle[]; loading: boolean; canCreate: boolean; busy: boolean; onRefresh: () => void; onOpen: (id: string) => void;
  onCreate: (input: { name: string; kind: Battle['kind']; battlefield: BattlefieldOptions }) => Promise<boolean>;
}

export function ArenaScreen({ characterId, arena, onChallenge, onDismiss, onAccept, rooms, loading, canCreate, busy, onRefresh, onOpen, onCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const [battlefield, setBattlefield] = useState<BattlefieldOptions>({ size: DEFAULT_FIELD_SIZE });
  const validField = battlefieldOptionsSchema.safeParse(battlefield);
  const [name, setName] = useState('Битва стихий');
  const [kind, setKind] = useState<Battle['kind']>('duel');
  return <section className="panel rooms" aria-label="Арена">
    <div className="section-heading arena-heading"><h2>Арена</h2><div>
      <button className="ghost" disabled={busy || loading} onClick={onRefresh}>Обновить ↻</button>
      <button className="primary" disabled={busy || !canCreate} aria-expanded={creating} aria-controls="create-room" onClick={() => setCreating(value => !value)}>{creating ? 'Отмена' : 'Создать комнату'}</button>
    </div></div>
    {arena?.activeBattleId && <div className="arena-offer"><strong>Бой начался</strong><button className="primary" onClick={() => onOpen(arena.activeBattleId!)}>Перейти в бой</button></div>}
    {creating && <form id="create-room" className="create-room" onSubmit={event => {
      event.preventDefault();
      if (busy || !canCreate || name.trim().length < 2 || !validField.success) return;
      void onCreate({ name: name.trim(), kind, battlefield }).then(created => { if (created) setCreating(false); });
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
    </form>}
    {!!arena?.incoming.length && <div className="arena-offers" aria-label="Входящие вызовы"><h3>Входящие вызовы</h3>
      {arena.incoming.map(offer => <div className="arena-offer" key={offer.id}><span><strong>{offer.challengerName} бросает тебе вызов</strong><small>{offer.roomName}</small></span><div>
        <button className="primary" disabled={busy} onClick={() => onAccept(offer)}>Принять</button><button className="ghost" disabled={busy} onClick={() => onDismiss(offer)}>Отклонить</button>
      </div></div>)}
    </div>}
    {!!arena?.outgoing.length && <div className="arena-offers" aria-label="Отправленные вызовы"><h3>Ожидают ответа</h3>
      {arena.outgoing.map(offer => <div className="arena-offer" key={offer.id}><span><strong>{offer.recipientName}</strong><small>{offer.roomName}</small></span>
        <button className="ghost" disabled={busy} onClick={() => onDismiss(offer)}>Отозвать</button></div>)}
    </div>}
    <div className="arena-rooms" aria-label="Комнаты сражений">
      {loading ? <p role="status">Загрузка комнат…</p> : rooms.length === 0 ? <p className="empty">Пока нет доступных комнат.</p> : rooms.map(room => {
        const own = room.fighters.some(fighter => fighter.characterId === characterId);
        const pending = arena?.outgoing.some(offer => offer.battleId === room.id);
        return <div className="arena-room" key={room.id}>
          <div className="room-row"><span><strong>{room.name}</strong><small>{room.fighters[0]?.name} · {kindNames[room.kind]}{own ? ' · Твоя комната' : ''}</small></span></div>
          {room.kind === 'duel' ? !own && <button className="primary" disabled={busy || !canCreate || pending}
            onClick={() => onChallenge(room.id)}>{pending ? 'Вызов отправлен' : 'Бросить вызов'}</button>
            : <button className="ghost" disabled={busy} onClick={() => onOpen(room.id)}>{own ? 'Открыть комнату' : 'Вступить'}</button>}
        </div>;
      })}
    </div>
  </section>;
}
