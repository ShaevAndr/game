import type { ArenaChallenge, ArenaState } from '@game/core';

interface Props {
  arena: ArenaState | null;
  busy: boolean;
  onAccept: (offer: ArenaChallenge) => void;
  onDismiss: (offer: ArenaChallenge) => void;
}

export function ArenaOffers({ arena, busy, onAccept, onDismiss }: Props) {
  return <>
    {!!arena?.incoming.length && <div className="arena-offers" aria-label="Входящие вызовы"><h3>Входящие вызовы</h3>
      {arena.incoming.map(offer => <div className="arena-offer" key={offer.id}><span><strong>{offer.challengerName} бросает тебе вызов</strong><small>{offer.roomName}</small></span><div>
        <button className="primary" disabled={busy} onClick={() => onAccept(offer)}>Принять</button><button className="ghost" disabled={busy} onClick={() => onDismiss(offer)}>Отклонить</button>
      </div></div>)}
    </div>}
    {!!arena?.outgoing.length && <div className="arena-offers" aria-label="Отправленные вызовы"><h3>Ожидают ответа</h3>
      {arena.outgoing.map(offer => <div className="arena-offer" key={offer.id}><span><strong>{offer.recipientName}</strong><small>{offer.roomName}</small></span>
        <button className="ghost" disabled={busy} onClick={() => onDismiss(offer)}>Отозвать</button></div>)}
    </div>}
  </>;
}
