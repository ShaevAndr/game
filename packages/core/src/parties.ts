import { z } from 'zod';

export const PARTY_CAPACITY = 6;
export const PARTY_INVITATION_TTL = 120_000;
export const PARTY_INVITATION_LIMIT = 12;
export const PARTY_DECLINE_COOLDOWN = 30_000;
export interface PartyMember { playerId: string; characterId: string; characterName: string; level: number; joinedAt: number }
export interface Party { id: string; revision: number; leaderPlayerId: string; members: PartyMember[] }
export interface PartyInvitation {
  id: string; partyId: string; inviterPlayerId: string; inviterCharacterName: string; targetPlayerId: string;
  createdAt: number; expiresAt: number; resolvedAt: number | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'; interactionRevision: number;
}
export type PartyInvitationView = Omit<PartyInvitation, 'interactionRevision'>;
export interface PartyState {
  party: Party | null; incoming: PartyInvitationView[]; outgoing: PartyInvitationView[];
  players: { id: string; name: string }[]; capacity: number; serverTime: number;
}
const target = z.string().uuid().transform(value => value.toLowerCase());
export const partyActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invite'), targetPlayerId: target }).strict(),
  z.object({ type: z.literal('accept'), invitationId: target }).strict(),
  z.object({ type: z.literal('decline'), invitationId: target }).strict(),
  z.object({ type: z.literal('cancel'), invitationId: target }).strict(),
  z.object({ type: z.literal('transfer'), targetPlayerId: target }).strict(),
  z.object({ type: z.literal('kick'), targetPlayerId: target }).strict(),
  z.object({ type: z.literal('leave') }).strict(),
  z.object({ type: z.literal('disband') }).strict(),
  z.object({ type: z.literal('change-character') }).strict(),
]);
export type PartyAction = z.infer<typeof partyActionSchema>;
export const partyCommandSchema = z.object({ operationId: z.string().uuid(), expectedPartyId: z.string().uuid().nullable(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), action: partyActionSchema }).strict();
export type PartyCommand = z.infer<typeof partyCommandSchema>;
export interface PartyCommandResult { party: Party | null; invitationId?: string; replayed: boolean }

export function addPartyMember(input: Party, member: PartyMember): Party {
  if (input.members.length >= PARTY_CAPACITY) throw new Error('В группе уже 6 игроков');
  if (input.members.some(existing => existing.playerId === member.playerId)) throw new Error('Игрок уже в группе');
  return { ...structuredClone(input), revision: input.revision + 1, members: [...structuredClone(input.members), { ...member }] };
}

export function applyPartyManagement(input: Party, actorId: string, action: Exclude<PartyAction, { type: 'invite' | 'accept' | 'decline' | 'cancel' }>, character?: PartyMember): Party | null {
  const party = structuredClone(input);
  if (!party.members.some(member => member.playerId === actorId)) throw new Error('Вы не состоите в группе');
  if (['transfer', 'kick', 'disband'].includes(action.type) && party.leaderPlayerId !== actorId) throw new Error('Действие доступно только лидеру группы');
  if (action.type === 'disband') return null;
  if (action.type === 'change-character') {
    if (!character || character.playerId !== actorId) throw new Error('Выберите своего персонажа');
    const member = party.members.find(member => member.playerId === actorId)!;
    Object.assign(member, { characterId: character.characterId, characterName: character.characterName, level: character.level });
  } else if (action.type === 'transfer') {
    if (action.targetPlayerId === actorId || !party.members.some(member => member.playerId === action.targetPlayerId)) throw new Error('Выберите другого участника группы');
    party.leaderPlayerId = action.targetPlayerId;
  } else {
    const targetId = action.type === 'leave' ? actorId : action.targetPlayerId;
    if (action.type === 'kick' && targetId === actorId) throw new Error('Для выхода используйте «Выйти из группы»');
    if (!party.members.some(member => member.playerId === targetId)) throw new Error('Участник не найден');
    party.members = party.members.filter(member => member.playerId !== targetId);
    if (!party.members.length) return null;
    if (party.leaderPlayerId === targetId) party.leaderPlayerId = party.members[0].playerId;
  }
  party.revision++;
  return party;
}

export function invitationView(invitation: PartyInvitation): PartyInvitationView {
  const { interactionRevision: _private, ...view } = invitation;
  return view;
}
