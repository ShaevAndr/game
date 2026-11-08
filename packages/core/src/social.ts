import { z } from 'zod';

export const socialActionSchema = z.enum(['friend-request', 'friend-accept', 'friend-decline', 'friend-cancel', 'friend-remove', 'block', 'unblock']);
export type SocialAction = z.infer<typeof socialActionSchema>;
export const socialCommandSchema = z.object({ operationId: z.string().uuid(), targetPlayerId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(), action: socialActionSchema }).strict();
export type SocialCommand = z.infer<typeof socialCommandSchema>;
export interface SocialPair {
  /** Admission epoch: blocking/unblocking permanently invalidates older invitations. */
  interactionRevision?: number;
  lowId: string; highId: string; revision: number;
  friendship: 'none' | 'pending' | 'accepted'; requesterId: string | null; blockedBy: string[];
}
export interface SocialRelationship { playerId: string; revision: number; friendship: 'none' | 'incoming' | 'outgoing' | 'accepted'; blocked: boolean }
export interface SocialState { revision: number; visibilityRevision: number; relationships: (SocialRelationship & { playerName: string })[] }
export interface SocialCommandResult { relationship: SocialRelationship; replayed: boolean }

export function socialRelationship(pair: SocialPair, viewerId: string): SocialRelationship {
  return { playerId: pair.lowId === viewerId ? pair.highId : pair.lowId, revision: pair.revision,
    friendship: pair.friendship === 'pending' ? pair.requesterId === viewerId ? 'outgoing' : 'incoming' : pair.friendship,
    blocked: pair.blockedBy.includes(viewerId) };
}
