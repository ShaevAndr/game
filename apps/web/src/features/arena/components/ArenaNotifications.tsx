import type { ArenaChallenge, ArenaState } from '@game/core';

interface Props {
  arena: ArenaState | null;
  roomId: string;
  busy: boolean;
  onRoom: (id: string) => void;
  onAccept: (offer: ArenaChallenge) => void;
  onDismiss: (offer: ArenaChallenge) => void;
}

export function ArenaNotifications({ arena, roomId, busy, onRoom, onAccept, onDismiss }: Props) {
  if (!arena || !arena.incoming.length && (!arena.activeBattleId || arena.activeBattleId === roomId)) return null;
  return <section className="arena-notifications" aria-label="Уведомления арены">
    {arena.activeBattleId && arena.activeBattleId !== roomId && <div className="arena-offer" role="status">
      <strong>Бой начался</strong>
      <button className="primary" onClick={() => onRoom(arena.activeBattleId!)}>Перейти в бой</button>
    </div>}
    {arena.incoming.map(offer => <div className="arena-offer" key={offer.id} role="status">
      <span><strong>{offer.challengerName} бросает тебе вызов</strong><small>{offer.roomName}</small></span>
      <div>
        <button className="primary" disabled={busy} onClick={() => onAccept(offer)}>Принять</button>
        <button className="ghost" disabled={busy} onClick={() => onDismiss(offer)}>Отклонить</button>
      </div>
    </div>)}
  </section>;
}
