import type { ChatEntry, ChatMessage } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';

export interface ChatStream { id: string; key: string; sequence: number }
export abstract class ChatRepository {
  abstract claim(senderId: string, operationId: string, signature: string, context: TransactionContext): Promise<{ signature: string; message: ChatMessage | null }>;
  abstract lockStreams(keys: string[], context: TransactionContext): Promise<ChatStream[]>;
  abstract recentCount(senderId: string, since: number, context: TransactionContext): Promise<number>;
  abstract save(message: ChatMessage, streams: ChatStream[], context: TransactionContext): Promise<void>;
  abstract heads(keys: string[], context?: TransactionContext): Promise<Record<string, number>>;
  abstract entries(key: string, from: number, to: number, direction: 'before' | 'after', limit: number, context?: TransactionContext): Promise<ChatEntry[]>;
}
