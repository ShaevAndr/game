import { useEffect, useState } from 'react';
import type { PartyAction, PartyState } from '@game/core';

interface Props { state: PartyState | null; playerId: string; characterId: string; busy: boolean; pending: boolean; error: string; message: string;
  onAction: (action: PartyAction) => void; onRetry: () => void; onRefresh: () => void }
export function PartyRoster({ state, playerId, characterId, busy, pending, error, message, onAction, onRetry, onRefresh }: Props) {
  const [targetId, setTargetId] = useState('');
  const [confirm, setConfirm] = useState<PartyAction | null>(null);
  const party = state?.party, leader = !party || party.leaderPlayerId === playerId, locked = busy || pending || !state;
  useEffect(() => { setConfirm(null); }, [party?.id, party?.revision]);
  const names = new Map(state?.players.map(player => [player.id, player.name]));
  return <section className="panel party-roster" aria-label="Ваша группа">
    <div className="party-roster-heading"><div><div className="section-label">ГРУППА</div><h2>{party ? `${party.members.length} / ${state?.capacity ?? 6} игроков` : 'Вместе сильнее'}</h2></div><button className="ghost" aria-label="Обновить группу" disabled={busy} onClick={onRefresh}>↻</button></div>
    {!state && !error && <p role="status">Загрузка группы…</p>}
    {state && !party && <p>Пригласите игрока, чтобы собрать группу до {state.capacity} человек.</p>}
    {party && <ol className="party-members">{[...party.members].sort((one, two) => Number(two.playerId === party.leaderPlayerId) - Number(one.playerId === party.leaderPlayerId)).map(member => <li className={member.playerId === party.leaderPlayerId ? 'party-leader' : ''} key={member.playerId}>
      <span className="party-avatar" aria-hidden="true">{Array.from(member.characterName)[0]}</span><div className="party-member-name"><strong>{member.characterName}</strong><small>{member.level} ур. {member.playerId === playerId ? '· Вы' : ''}</small>{member.playerId === party.leaderPlayerId && <span className="party-leader-label">♛ Лидер</span>}</div>
      {leader && member.playerId !== playerId && <details className="party-member-menu"><summary aria-label={`Действия: ${member.characterName}`}>⋯</summary><div><button disabled={locked} onClick={() => setConfirm({ type: 'transfer', targetPlayerId: member.playerId })}>Передать лидерство</button><button disabled={locked} onClick={() => setConfirm({ type: 'kick', targetPlayerId: member.playerId })}>Исключить из группы</button></div></details>}
    </li>)}</ol>}
    {leader && <form className="party-invite-form" onSubmit={event => { event.preventDefault(); if (targetId) onAction({ type: 'invite', targetPlayerId: targetId }); }}>
      <label>Пригласить игрока<select aria-label="Игрок для приглашения в группу" disabled={locked || (party?.members.length ?? 0) >= (state?.capacity ?? 6)} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Выберите игрока</option>{state?.players.filter(player => !party?.members.some(member => member.playerId === player.id)).map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
      <button disabled={locked || !targetId || (party?.members.length ?? 0) >= (state?.capacity ?? 6)}>Пригласить в группу</button>
    </form>}
    {!!state?.outgoing.length && <div className="party-outgoing"><h3>Приглашения</h3>{state.outgoing.map(invitation => <div key={invitation.id}><span>{names.get(invitation.targetPlayerId) ?? 'Игрок'}</span><button className="ghost" disabled={locked} onClick={() => onAction({ type: 'cancel', invitationId: invitation.id })}>Отменить</button></div>)}</div>}
    {party && <div className="party-controls">
      {party.members.find(member => member.playerId === playerId)?.characterId !== characterId && <button disabled={locked} onClick={() => onAction({ type: 'change-character' })}>Сменить персонажа группы</button>}
      <button className="ghost" disabled={locked} onClick={() => setConfirm({ type: 'leave' })}>Выйти из группы</button>
      {leader && <button className="ghost party-danger" disabled={locked} onClick={() => setConfirm({ type: 'disband' })}>Распустить группу</button>}
    </div>}
    {confirm && <div className="party-confirm" role="group" aria-label="Подтверждение действия"><p>{confirm.type === 'transfer' ? 'Передать лидерство выбранному участнику?' : confirm.type === 'kick' ? 'Исключить выбранного участника?' : confirm.type === 'leave' ? 'Выйти из группы?' : 'Распустить группу для всех участников?'}</p><div><button disabled={locked} onClick={() => { onAction(confirm); setConfirm(null); }}>Подтвердить</button><button className="ghost" onClick={() => setConfirm(null)}>Отмена</button></div></div>}
    {message && <p className="party-message" role="status">{message}</p>}
    {error && <p className="party-error" role="alert">{error}</p>}
    {pending && <div className="party-pending"><p>Результат действия ещё не подтверждён.</p><button disabled={busy} onClick={onRetry}>Повторить действие</button></div>}
  </section>;
}
