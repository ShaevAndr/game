import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SocialAction, SocialRelationship } from '@game/core';

interface Props { playerId: string; name: string; title: string; relationship?: SocialRelationship; busy: boolean;
  onAction: (action: SocialAction, playerId: string) => void; onMessage: (playerId: string) => void;
  onInvite?: (playerId: string) => void; inviteDisabled?: boolean }
export function AuthorMenu({ playerId, name, title, relationship, busy, onAction, onMessage, onInvite, inviteDisabled }: Props) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect(), popup = menu.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(anchor.left, innerWidth - popup.width - 8)),
      top: anchor.bottom + popup.height + 6 <= innerHeight - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - popup.height - 6) });
    menu.current.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [open]);
  const act = (action: SocialAction) => { setOpen(false); trigger.current?.focus(); onAction(action, playerId); };
  const friendship = relationship?.friendship ?? 'none';
  return <>
    <button ref={trigger} type="button" className="chat-author-name" title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{name}</button>
    {open && createPortal(<div ref={menu} role="menu" tabIndex={-1} aria-label={`Действия: ${title}`} className="chat-author-menu" style={position} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); trigger.current?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement), step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
      }
    }}>
      <span>{title}</span>
      {onInvite && <button role="menuitem" disabled={busy || inviteDisabled || relationship?.blocked} onClick={() => { setOpen(false); trigger.current?.focus(); onInvite(playerId); }}>Пригласить в группу</button>}
      {relationship?.blocked ? <button role="menuitem" disabled={busy} onClick={() => act('unblock')}>Убрать из чёрного списка</button> : <>
        {friendship === 'none' && <button role="menuitem" disabled={busy} onClick={() => act('friend-request')}>Добавить в друзья</button>}
        {friendship === 'outgoing' && <button role="menuitem" disabled={busy} onClick={() => act('friend-cancel')}>Отменить заявку в друзья</button>}
        {friendship === 'incoming' && <><button role="menuitem" disabled={busy} onClick={() => act('friend-accept')}>Принять заявку в друзья</button><button role="menuitem" disabled={busy} onClick={() => act('friend-decline')}>Отклонить заявку</button></>}
        {friendship === 'accepted' && <button role="menuitem" disabled={busy} onClick={() => act('friend-remove')}>Удалить из друзей</button>}
        <button role="menuitem" disabled={busy} onClick={() => act('block')}>Добавить в чёрный список</button>
      </>}
      <button role="menuitem" disabled={relationship?.blocked} onClick={() => { setOpen(false); onMessage(playerId); }}>Личное сообщение</button>
    </div>, document.body)}
  </>;
}
