import { useEffect, useRef } from 'react';
import type { PartyInvitationView } from '@game/core';

interface Props { invitation: PartyInvitationView; characterName?: string; serverNow: number; busy: boolean; pending: boolean; error: string; onRespond: (accept: boolean) => void; onRetry: () => void }
export function PartyInvitationDialog({ invitation, characterName, serverNow, busy, pending, error, onRespond, onRetry }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [invitation.id]);
  const remaining = Math.max(0, Math.ceil((invitation.expiresAt - serverNow) / 1000));
  return <dialog ref={dialog} className="party-invitation-dialog" aria-labelledby="party-invitation-title" aria-describedby="party-invitation-description" onCancel={event => { event.preventDefault(); if (!busy && !pending) onRespond(false); }}>
    <div className="party-dialog-emblem" aria-hidden="true">♜</div><div className="eyebrow">ПРИГЛАШЕНИЕ В ГРУППУ</div>
    <h2 id="party-invitation-title">Вас приглашают в группу</h2>
    <p id="party-invitation-description">Персонаж <strong>{invitation.inviterCharacterName}</strong> приглашает вас в группу. Принять приглашение?</p>
    {characterName && <p className="party-dialog-character">Вы вступите персонажем «{characterName}».</p>}
    <p className="party-dialog-time">Приглашение действует ещё {remaining} с</p>
    {error && <p className="party-error" role="alert">{error}</p>}
    {pending ? <div className="party-dialog-actions"><p>Ожидается подтверждение действия.</p><button disabled={busy} onClick={onRetry}>Повторить действие</button></div>
      : <div className="party-dialog-actions"><button className="ghost" disabled={busy} onClick={() => onRespond(false)}>Отказаться</button><button className="primary" disabled={busy} autoFocus onClick={() => onRespond(true)}>Принять</button></div>}
  </dialog>;
}
