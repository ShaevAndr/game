import { useSocial } from '../social/model/useSocial';
import type { AccountSession, Party } from '@game/core';
import { useChat } from './model/useChat';
import { ChatWindow } from './components/ChatWindow';
import './chat.css';

export function ChatPanel({ session, enabled, onInvite, inviteDisabled, party }: { session: AccountSession; enabled: boolean; onInvite?: (playerId: string) => void; inviteDisabled?: boolean; party: Party | null }) {
  const social = useSocial(enabled);
  const member = party?.members.find(member => member.playerId === session.account.id);
  const partyAccess = party && member ? `${party.id}:${member.membershipId}` : null;
  const chat = useChat(session, enabled, social.state?.visibilityRevision ?? 0, party?.id ?? null, partyAccess);
  const hidden = new Set(social.state?.relationships.filter(row => row.blocked).map(row => row.playerId));
  const players = new Map(chat.players.map(player => [player.id, player.name]));
  for (const row of social.state?.relationships ?? []) players.set(row.playerId, row.playerName);
  if (!enabled) return null;
  return <ChatWindow {...chat} onInvite={onInvite} inviteDisabled={inviteDisabled} players={[...players].map(([id, name]) => ({ id, name }))} messages={chat.messages.filter(message => !hidden.has(message.senderPlayerId))} social={social.state} socialBusy={social.busy || !social.state}
    error={social.error || chat.error} onSocial={(action, id) => void social.act(action, id)} playerId={session.account.id} onOpen={chat.setOpen} onView={chat.setView} onDraft={chat.setDraft}
    onDestination={chat.setRecipientId} onRecipient={chat.chooseRecipient} onSend={() => { if (!hidden.has(chat.recipientId)) void chat.send(); }} onOlder={() => void chat.loadOlder()}/>;
}
