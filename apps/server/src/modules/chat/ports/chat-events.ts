import type { ChatMessage } from '@game/core';
export abstract class ChatEvents { abstract publish(message: ChatMessage): Promise<void> }
