import type { GatheringCommand, GatheringReceipt, GatheringView } from '@game/core';
import { request } from '../../../shared/api/http';

export const gatheringApi = {
  get: (ownerId: string, signal?: AbortSignal) => request<GatheringView>(`/characters/${ownerId}/gathering`, { signal }),
  execute: (ownerId: string, command: GatheringCommand) => request<GatheringReceipt>(`/characters/${ownerId}/gathering/actions`, { body: command }),
};
