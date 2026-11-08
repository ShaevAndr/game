import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Account, AccountSession, ChatMessage, ChatSend, ChatView } from '@game/core';
import { ApiError, getSessionToken } from '../../../shared/api/http';
import { identityApi } from '../../identity/api/identity.api';
import { chatApi } from '../api/chat.api';

const merge = (previous: ChatMessage[], incoming: ChatMessage[]) => [...new Map([...previous, ...incoming].map(message => [message.id, message])).values()]
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export function useChat(session: AccountSession, enabled: boolean, visibilityRevision: number, partyId: string | null, partyAccess: string | null) {
  const [open, setOpen] = useState(false), [view, setView] = useState<ChatView>('all');
  const [messages, setMessages] = useState<ChatMessage[]>([]), [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState(''), [recipientId, setRecipientId] = useState('');
  const [connected, setConnected] = useState(false), [loading, setLoading] = useState(false), [loadingOlder, setLoadingOlder] = useState(false), [hasOlder, setHasOlder] = useState(false);
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState(''), [feedError, setFeedError] = useState('');
  const [feedPartyAccess, setFeedPartyAccess] = useState<string | null>(null);
  const older = useRef<() => Promise<void>>(async () => {});
  const pendingSend = useRef<{ signature: string; body: ChatSend } | undefined>(undefined);
  const sendingNow = useRef(false), activeView = useRef(view);
  const activePartyAccess = useRef(partyAccess);
  activeView.current = view;
  activePartyAccess.current = partyAccess;

  useEffect(() => {
    if (!enabled) { setConnected(false); return; }
    let cancelled = false, pending = false, again = false, olderPending = false;
    let after = '', before = '';
    const controller = new AbortController();
    setLoading(true); setMessages([]); setFeedPartyAccess(null); setHasOlder(false); setLoadingOlder(false); setFeedError('');
    const update = (incoming: ChatMessage[]) => { if (!cancelled) setMessages(current => merge(current, incoming)); };
    const load = async (): Promise<void> => {
      if (cancelled) return;
      if (pending) { again = true; return; }
      pending = true;
      try {
        let more = false;
        do {
          const initial = !after;
          const result = await chatApi.feed(view, initial ? {} : { after }, controller.signal);
          if (cancelled) return;
          setFeedError(''); after = result.after;
          setFeedPartyAccess(result.partyAccess);
          if (initial) { before = result.before; setHasOlder(result.hasMore); }
          update(result.messages);
          more = !initial && result.hasMore;
        } while (more && !cancelled);
      } catch (reason) {
        if (!cancelled) {
          if (reason instanceof ApiError && reason.status === 410) { after = ''; before = ''; setMessages([]); setFeedPartyAccess(null); again = true; }
          else setFeedError((reason as Error).message);
        }
      } finally {
        pending = false;
        if (!cancelled) {
          setLoading(false);
          if (again) { again = false; void load(); }
        }
      }
    };
    older.current = async () => {
      if (!before || cancelled || olderPending) return;
      olderPending = true; setLoadingOlder(true);
      try {
        const result = await chatApi.feed(view, { before }, controller.signal);
        if (!cancelled) { setFeedError(''); setFeedPartyAccess(result.partyAccess); before = result.before; setHasOlder(result.hasMore); update(result.messages); }
      } catch (reason) {
        if (!cancelled) {
          if (reason instanceof ApiError && reason.status === 410) { after = ''; before = ''; setMessages([]); setFeedPartyAccess(null); void load(); }
          else setFeedError((reason as Error).message);
        }
      }
      finally { olderPending = false; if (!cancelled) setLoadingOlder(false); }
    };
    const socket = io('/chat', { autoConnect: false, auth: { token: getSessionToken() } });
    socket.on('connect', () => {
      socket.timeout(5000).emit('subscribe', (failure: Error | null, result?: { ok?: boolean; error?: string }) => {
        if (cancelled) return;
        setConnected(!failure && !!result?.ok);
        void load();
      });
    });
    socket.on('message.created', () => { void load(); });
    socket.on('disconnect', () => { if (!cancelled) setConnected(false); });
    socket.on('connect_error', () => { if (!cancelled) setConnected(false); });
    void load();
    void identityApi.list(controller.signal).then(list => { if (!cancelled) setAccounts(list); }).catch(() => {});
    socket.connect();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); socket.removeAllListeners(); socket.disconnect(); older.current = async () => {}; };
  }, [session.account.id, enabled, view, visibilityRevision, partyAccess]);

  const chooseRecipient = (id: string) => { setRecipientId(id); setView('direct'); setOpen(true); };
  const chooseView = (next: ChatView) => { setView(next); if (next === 'party' && partyId) setRecipientId(`party:${partyId}`); };
  const send = async () => {
    if (sendingNow.current || !session.characterId || !draft.trim() || !enabled) return;
    const groupDestination = recipientId.startsWith('party:');
    if (groupDestination && recipientId !== `party:${partyId}`) { setSendError('Вы больше не состоите в этой группе. Выберите адресата заново.'); return; }
    const destination: ChatSend['destination'] = groupDestination ? { kind: 'party', partyId: recipientId.slice(6) }
      : recipientId ? { kind: 'direct', recipientPlayerId: recipientId } : { kind: 'world' };
    const signature = JSON.stringify({ authorCharacterId: session.characterId, destination, text: draft.trim() });
    if (pendingSend.current?.signature !== signature) pendingSend.current = { signature, body: { operationId: crypto.randomUUID(), authorCharacterId: session.characterId, destination, segments: [{ kind: 'text', text: draft.trim() }] } };
    const body = pendingSend.current.body;
    const sendingPartyAccess = partyAccess;
    sendingNow.current = true; setSending(true); setSendError('');
    try {
      const message = await chatApi.send(body);
      if ((message.channel !== 'party' || activePartyAccess.current === sendingPartyAccess) && (activeView.current === 'all' || activeView.current === message.channel)) setMessages(current => merge(current, [message]));
      setDraft(''); pendingSend.current = undefined;
    } catch (reason) { setSendError((reason as Error).message); }
    finally { sendingNow.current = false; setSending(false); }
  };
  const players = new Map(accounts.map(account => [account.id, account.name]));
  for (const message of messages) {
    if (!players.has(message.senderPlayerId)) players.set(message.senderPlayerId, message.senderName);
    if (message.recipientPlayerId && !players.has(message.recipientPlayerId)) players.set(message.recipientPlayerId, message.recipientName ?? 'Игрок');
  }
  players.delete(session.account.id);
  const visibleMessages = messages.filter(message => message.channel !== 'party' || !!partyAccess && feedPartyAccess === partyAccess && message.partyId === partyId);
  return { open, setOpen, view, setView: chooseView, messages: visibleMessages, partyId, players: [...players].map(([id, name]) => ({ id, name })), draft, setDraft, recipientId, setRecipientId, chooseRecipient,
    connected, loading, loadingOlder, hasOlder, sending, error: sendError || feedError, send, loadOlder: () => older.current() };
}
