import type { ChatFeed, ChatMessage, ChatSend, ChatView } from '@game/core';
import { request } from '../../../shared/api/http';

export const chatApi = {
  feed: (view: ChatView, cursor: { before?: string; after?: string } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams({ view, ...cursor });
    return request<ChatFeed>(`/chat/feed?${query}`, { signal });
  },
  send: (body: ChatSend) => request<ChatMessage>('/chat/messages', { body }),
};
