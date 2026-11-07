import type { AccountSession } from '@game/core';
import { useChat } from './model/useChat';
import { ChatWindow } from './components/ChatWindow';
import './chat.css';

export function ChatPanel({ session, enabled }: { session: AccountSession; enabled: boolean }) {
  const chat = useChat(session, enabled);
  if (!enabled) return null;
  return <ChatWindow {...chat} playerId={session.account.id} onOpen={chat.setOpen} onView={chat.setView} onDraft={chat.setDraft}
    onDestination={chat.setRecipientId} onRecipient={chat.chooseRecipient} onSend={() => void chat.send()} onOlder={() => void chat.loadOlder()}/>;
}
