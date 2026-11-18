import type { ArenaState, Battle } from '@game/core';
import { kindNames } from '../../../shared/ui/game-labels';

interface Props {
  rooms: Battle[];
  characterId: string;
  arena: ArenaState | null;
  loading: boolean;
  busy: boolean;
  canCreate: boolean;
  onChallenge: (id: string) => void;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
}

export function ArenaRoomList({ rooms, characterId, arena, loading, busy, canCreate, onChallenge, onOpen, onCancel }: Props) {
  return <div className="arena-rooms" aria-label="Комнаты сражений">
      {loading ? <p role="status">Загрузка комнат…</p> : rooms.length === 0 ? <p className="empty">Пока нет доступных комнат.</p> : rooms.map(room => {
        const own = room.fighters.some(fighter => fighter.characterId === characterId);
        const pending = arena?.outgoing.some(offer => offer.battleId === room.id);
        return <div className="arena-room" key={room.id}>
          <div className="room-row"><span><strong>{room.name}</strong><small>{room.fighters[0]?.name} · {kindNames[room.kind]}{own ? ' · Твоя комната' : ''}</small></span></div>
          {room.kind === 'duel' ? !own && <button className="primary" disabled={busy || !canCreate || pending}
            onClick={() => onChallenge(room.id)}>{pending ? 'Вызов отправлен' : 'Бросить вызов'}</button>
            : <button className="ghost" disabled={busy} onClick={() => onOpen(room.id)}>{own ? 'Открыть комнату' : 'Вступить'}</button>}
          {room.fighters[0]?.characterId === characterId && <button className="ghost" disabled={busy} onClick={() => onCancel(room.id)}>Отменить комнату</button>}
        </div>;
      })}
    </div>;
}
