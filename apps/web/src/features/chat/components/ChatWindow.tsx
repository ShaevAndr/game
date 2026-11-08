import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AuthorMenu } from '../../social/components/AuthorMenu';
import { SocialPanel } from '../../social/components/SocialPanel';
import type { ChatMessage, ChatView, SocialAction, SocialState } from '@game/core';

interface Props {
  open: boolean; view: ChatView; messages: ChatMessage[]; playerId: string; players: { id: string; name: string }[];
  draft: string; recipientId: string; connected: boolean; loading: boolean; hasOlder: boolean; loadingOlder: boolean; sending: boolean; error: string;
  partyId: string | null;
  social: SocialState | null; socialBusy: boolean; onSocial: (action: SocialAction, id: string) => void;
  onInvite?: (playerId: string) => void; inviteDisabled?: boolean;
  onOpen: (value: boolean) => void; onView: (view: ChatView) => void; onDraft: (text: string) => void;
  onDestination: (id: string) => void; onRecipient: (id: string) => void; onSend: () => void; onOlder: () => void;
}
const labels: Record<ChatView, string> = { all: 'Все', world: 'Мир', direct: 'Личные', party: 'Группа' };

export function ChatWindow(props: Props) {
  const list = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true), previous = useRef({ first: '', height: 0 });
  const [showSocial, setShowSocial] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  useEffect(() => { atBottom.current = true; setNewMessages(false); }, [props.view, props.open]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const first = props.messages[0]?.id ?? '';
    if (atBottom.current) element.scrollTop = element.scrollHeight;
    else if (previous.current.first !== first && props.messages.some(message => message.id === previous.current.first)) element.scrollTop += element.scrollHeight - previous.current.height;
    else if (previous.current.height !== element.scrollHeight) setNewMessages(true);
    previous.current = { first, height: element.scrollHeight };
  }, [props.messages, props.open, showSocial]);
  const recipient = (id: string) => { setShowSocial(false); props.onRecipient(id); requestAnimationFrame(() => input.current?.focus()); };
  const blockedRecipient = props.social?.relationships.some(row => row.playerId === props.recipientId && row.blocked);
  const unavailableParty = props.recipientId.startsWith('party:') && props.recipientId !== `party:${props.partyId}`;
  if (!props.open) return <button className="chat-toggle" onClick={() => props.onOpen(true)} aria-label="Открыть чат">☷ Чат</button>;
  return <section className="chat-window" aria-label="Чат">
    <header className="chat-header"><strong>Чат</strong><span className={props.connected ? 'chat-online' : ''}>{props.connected ? 'Онлайн' : 'Обновление каждые 5 с'}</span><button className="ghost" aria-label="Свернуть чат" onClick={() => props.onOpen(false)}>—</button></header>
    <div className="chat-tabs" role="tablist" aria-label="Канал просмотра">{(['all', 'world', 'party', 'direct'] as const).map(view => <button key={view} role="tab" disabled={view === 'party' && !props.partyId} aria-selected={!showSocial && props.view === view} onClick={() => { setShowSocial(false); props.onView(view); }}>{labels[view]}</button>)}<button role="tab" aria-selected={showSocial} onClick={() => setShowSocial(true)}>Игроки{props.social?.relationships.some(row => row.friendship === 'incoming') ? ' •' : ''}</button></div>
    {showSocial && <SocialPanel state={props.social} players={props.players} busy={props.socialBusy} onAction={props.onSocial} onMessage={recipient} onInvite={props.onInvite} inviteDisabled={props.inviteDisabled}/>}
    <div className="chat-messages" hidden={showSocial} ref={list} role="log" aria-label={`Сообщения: ${labels[props.view]}`} onScroll={() => { const element = list.current!; atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 35; if (atBottom.current) setNewMessages(false); }}>
      {props.hasOlder && <button className="ghost chat-older" disabled={props.loadingOlder} onClick={props.onOlder}>{props.loadingOlder ? 'Загрузка…' : 'Ранние сообщения'}</button>}
      {props.loading && <p className="chat-empty" role="status">Загрузка сообщений…</p>}
      {!props.loading && !props.messages.length && <p className="chat-empty">{props.view === 'party' ? props.partyId ? 'Здесь будут сообщения вашей группы.' : 'Вы больше не состоите в группе.' : props.view === 'direct' ? 'Здесь будут личные сообщения со всеми собеседниками.' : 'Сообщений пока нет.'}</p>}
      {props.messages.map(message => <article className={`chat-message ${message.senderPlayerId === props.playerId ? 'own' : ''}`} key={message.id}>
        <div className="chat-message-meta"><span className={`chat-channel ${message.channel}`}>{message.channel === 'world' ? 'Мир' : message.channel === 'party' ? 'Группа' : 'Лично'}</span>
          {message.senderPlayerId === props.playerId ? <strong>Ты{message.recipientName ? ` → ${message.recipientName}` : ''}</strong> : <AuthorMenu playerId={message.senderPlayerId} name={`${message.authorName}${message.channel === 'direct' ? ' → тебе' : ''}`} title={message.senderName}
            relationship={props.social?.relationships.find(row => row.playerId === message.senderPlayerId)} busy={props.socialBusy}
            onAction={props.onSocial} onMessage={recipient} onInvite={props.onInvite} inviteDisabled={props.inviteDisabled}/>}
          <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <p className="chat-text">{message.segments.map(segment => segment.text).join('')}</p>
      </article>)}
    </div>
    {newMessages && <button className="chat-new" onClick={() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; atBottom.current = true; setNewMessages(false); }}>Новые сообщения ↓</button>}
    <form className="chat-compose" onSubmit={event => { event.preventDefault(); props.onSend(); }}>
      <label>Отправить<select aria-label="Адресат сообщения" disabled={props.sending} value={props.recipientId} onChange={event => props.onDestination(event.target.value)}>
        <option value="">В мир</option>{props.partyId && <option value={`party:${props.partyId}`}>В группу</option>}{unavailableParty && <option value={props.recipientId} disabled>Прежняя группа недоступна</option>}{props.players.map(player => <option key={player.id} value={player.id}>Лично: {player.name}</option>)}
      </select></label>
      <textarea ref={input} aria-label="Текст сообщения" placeholder="Напиши сообщение…" value={props.draft} disabled={props.sending} maxLength={2000} onChange={event => props.onDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); props.onSend(); } }}/>
      {blockedRecipient && <p className="chat-error" role="status">Игрок в чёрном списке. Личная отправка недоступна.</p>}
      {unavailableParty && <p className="chat-error" role="status">Группа изменилась. Выберите адресата заново; черновик сохранён.</p>}
      {props.error && <p className="chat-error" role="alert">{props.error}</p>}
      <div className="chat-send-row"><span>{Array.from(props.draft).length} / 1000</span><button className="primary" disabled={blockedRecipient || unavailableParty || props.sending || !props.draft.trim() || Array.from(props.draft.trim()).length > 1000}>{props.sending ? 'Отправка…' : 'Отправить →'}</button></div>
    </form>
  </section>;
}
