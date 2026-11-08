import type { ChatMessage } from '@game/core';
export interface ChatPartyRecipient { playerId: string; membershipId: string }
export abstract class ChatEvents { abstract publish(message: ChatMessage, partyRecipients?: ChatPartyRecipient[]): Promise<void> }
