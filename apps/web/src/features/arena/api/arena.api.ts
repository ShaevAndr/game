import { Battle, BattlefieldOptions, Rule } from '@game/core';
import { request } from '../../../shared/api/http';

export const arenaApi = {
  list: () => request<Battle[]>('/battles'),
  create: (input: { name: string; characterId: string; kind: Battle['kind']; rule?: Rule; battlefield?: BattlefieldOptions }) => request<Battle>('/battles', { body: input }),
};
