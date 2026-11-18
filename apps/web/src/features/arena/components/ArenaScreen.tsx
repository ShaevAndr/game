import { useState } from 'react';
import type { ArenaChallenge, ArenaState, Battle } from '@game/core';
import { CreateRoomForm, type CreateRoomInput } from './CreateRoomForm';
import { ArenaOffers } from './ArenaOffers';
import { ArenaRoomList } from './ArenaRoomList';
import '../arena.css';

interface Props {
  characterId: string; arena: ArenaState | null; onChallenge: (id: string) => void; onDismiss: (offer: ArenaChallenge) => void; onAccept: (offer: ArenaChallenge) => void;
  rooms: Battle[]; loading: boolean; canCreate: boolean; busy: boolean; onRefresh: () => void; onOpen: (id: string) => void; onCancel: (id: string) => void;
  onCreate: (input: CreateRoomInput) => Promise<boolean>;
}

export function ArenaScreen(props: Props) {
  const { arena, busy, loading, canCreate, onRefresh, onOpen, onCreate, onAccept, onDismiss } = props;
  const [creating, setCreating] = useState(false);
  return <section className="panel rooms" aria-label="Арена">
    <div className="section-heading arena-heading"><h2>Арена</h2><div>
      <button className="ghost" disabled={busy || loading} onClick={onRefresh}>Обновить ↻</button>
      <button className="primary" disabled={busy || !canCreate} aria-expanded={creating} aria-controls="create-room" onClick={() => setCreating(value => !value)}>{creating ? 'Отмена' : 'Создать комнату'}</button>
    </div></div>
    {arena?.activeBattleId && <div className="arena-offer"><strong>Бой начался</strong><button className="primary" onClick={() => onOpen(arena.activeBattleId!)}>Перейти в бой</button></div>}
    <CreateRoomForm open={creating} busy={busy} canCreate={canCreate} onCreate={onCreate} onCreated={() => setCreating(false)}/>
    <ArenaOffers arena={arena} busy={busy} onAccept={onAccept} onDismiss={onDismiss}/>
    <ArenaRoomList {...props}/>
  </section>;
}
