import { z } from 'zod';

export const CHAT_WORLD_STREAM = 'world';
export const directChatStream = (playerId: string) => `direct:${playerId}`;
export const chatDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('world') }).strict(),
  z.object({ kind: z.literal('direct'), recipientPlayerId: z.string().uuid() }).strict(),
]);
const text = z.string().trim().min(1).max(2000).refine(value => Array.from(value).length <= 1000, 'Не больше 1000 символов');
export const chatSendSchema = z.object({
  operationId: z.string().uuid(), authorCharacterId: z.string().uuid(),
  destination: chatDestinationSchema,
  segments: z.array(z.object({ kind: z.literal('text'), text }).strict()).length(1),
}).strict();
export type ChatSend = z.infer<typeof chatSendSchema>;
export type ChatView = 'all' | 'world' | 'direct';
export interface ChatMessage {
  id: string; operationId: string; senderPlayerId: string; authorCharacterId: string;
  authorName: string; senderName: string; channel: 'world' | 'direct';
  recipientPlayerId: string | null; recipientName: string | null; createdAt: string;
  segments: { kind: 'text'; text: string }[];
}
export interface ChatFeed { messages: ChatMessage[]; after: string; before: string; hasMore: boolean }
export interface ChatEntry { streamKey: string; sequence: number; message: ChatMessage }

/** Consume a prefix of each stream, so a timestamp tie cannot skip a lower sequence. */
export function mergeChatStreams(streams: ChatEntry[][], limit: number, direction: 'before' | 'after') {
  const positions = streams.map(() => 0), entries: ChatEntry[] = [];
  while (entries.length < limit) {
    let selected = -1;
    for (let i = 0; i < streams.length; i++) {
      const candidate = streams[i][positions[i]];
      if (!candidate) continue;
      if (selected < 0) { selected = i; continue; }
      const current = streams[selected][positions[selected]];
      const order = candidate.message.createdAt.localeCompare(current.message.createdAt) || candidate.message.id.localeCompare(current.message.id);
      if (direction === 'before' ? order > 0 : order < 0) selected = i;
    }
    if (selected < 0) break;
    entries.push(streams[selected][positions[selected]++]);
  }
  return { entries, hasMore: streams.some((stream, i) => positions[i] < stream.length) };
}
