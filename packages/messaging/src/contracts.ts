export type MessagePeer = 'server' | 'world';
export interface MessageContext { id: string; type: string; producer: MessagePeer }
export type MessageHandler = (payload: unknown, context: MessageContext) => Promise<unknown>;
export class MessageFailure extends Error {
  constructor(message: string, readonly retryable = true, readonly code = 'MESSAGE_UNAVAILABLE') { super(message); this.name = 'MessageFailure'; }
}
export abstract class MessageBus {
  abstract enabled(): boolean;
  abstract request(peer: MessagePeer, type: string, id: string, payload: unknown): Promise<unknown>;
  abstract handle(type: string, producer: MessagePeer, handler: MessageHandler): () => void;
}
