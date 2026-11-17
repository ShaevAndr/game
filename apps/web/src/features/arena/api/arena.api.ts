import { ArenaChallenge, ArenaState, Battle, BattlefieldOptions, Rule } from '@game/core';
import { request } from '../../../shared/api/http';

export const arenaApi = {
  state: (characterId: string) => request<ArenaState>(`/battles/arena/${characterId}`),
  challenge: (id: string, characterId: string) => request<ArenaChallenge>(`/battles/${id}/challenges`, { body: { characterId } }),
  accept: (offer: ArenaChallenge, characterId: string) => request<Battle>(`/battles/${offer.battleId}/challenges/${offer.id}/accept`, { body: { characterId } }),
  dismiss: (offer: ArenaChallenge, characterId: string) => request<{ ok: boolean }>(`/battles/${offer.battleId}/challenges/${offer.id}/dismiss`, { body: { characterId } }),
  list: () => request<Battle[]>('/battles'),
  cancel: (id: string, characterId: string) => request<{ ok: boolean }>(`/battles/${id}/cancel`, { body: { characterId } }),
  create: (input: { name: string; characterId: string; kind: Battle['kind']; rule?: Rule; battlefield?: BattlefieldOptions }) => request<Battle>('/battles', { body: input }),
};
