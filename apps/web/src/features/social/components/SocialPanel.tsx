import type { SocialAction, SocialState } from '@game/core';
interface Props { state: SocialState | null; players: { id: string; name: string }[]; busy: boolean;
  onAction: (action: SocialAction, id: string) => void; onMessage: (id: string) => void;
  onInvite?: (playerId: string) => void; inviteDisabled?: boolean }
export function SocialPanel({ state, players, busy, onAction, onMessage, onInvite, inviteDisabled }: Props) {
  if (!state) return <div className="chat-social"><p role="status">Загрузка игроков…</p></div>;
  const names = new Map(players.map(player => [player.id, player.name]));
  const sections = [
    { title: 'Входящие заявки', rows: state.relationships.filter(row => row.friendship === 'incoming'), actions: [['friend-accept', 'Принять'], ['friend-decline', 'Отклонить']] },
    { title: 'Друзья', rows: state.relationships.filter(row => row.friendship === 'accepted'), actions: [['friend-remove', 'Удалить']] },
    { title: 'Отправленные заявки', rows: state.relationships.filter(row => row.friendship === 'outgoing'), actions: [['friend-cancel', 'Отменить']] },
    { title: 'Чёрный список', rows: state.relationships.filter(row => row.blocked), actions: [['unblock', 'Убрать из ЧС']] },
  ] as const;
  return <div className="chat-social" aria-label="Друзья и чёрный список">{sections.map(section => <section key={section.title}><h3>{section.title} <span>{section.rows.length}</span></h3>
    {!section.rows.length && <p>Список пуст</p>}
    {section.rows.map(row => <div className="chat-social-row" key={row.playerId}><strong>{row.playerName || names.get(row.playerId) || 'Игрок'}</strong><div>
      {!row.blocked && <button className="ghost" onClick={() => onMessage(row.playerId)}>Написать</button>}
      {!row.blocked && row.friendship === 'accepted' && onInvite && <button className="ghost" disabled={busy || inviteDisabled} onClick={() => onInvite(row.playerId)}>В группу</button>}
      {section.actions.map(([action, label]) => <button className="ghost" key={action} disabled={busy} onClick={() => onAction(action, row.playerId)}>{label}</button>)}
    </div></div>)}
  </section>)}</div>;
}
