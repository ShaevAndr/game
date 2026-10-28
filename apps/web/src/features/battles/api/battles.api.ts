import { Action, Battle } from '@game/core';
import { request } from '../../../shared/api/http';

export const battlesApi = {
  get: (id: string, signal?: AbortSignal) => request<Battle>(`/battles/${id}`, { signal }),
  join: (id: string, characterId: string, team: number) => request<Battle>(`/battles/${id}/join`, { body: { characterId, team } }),
  start: (id: string, characterId: string, version: number) => request<Battle>(`/battles/${id}/start`, { body: { characterId, version } }),
  command: (id: string, characterId: string, version: number, action: Action) => request<Battle>(`/battles/${id}/actions`, { body: { characterId, version, action } }),
};
