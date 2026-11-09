import type { CurrentWorldExpedition, WorldCommand, WorldCommandResult, WorldDeliveryResult, WorldExpeditionView, WorldCargoDocument, CargoImportProof } from '@game/core';
import { request } from '../../../shared/api/http';
const deadline = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
export const worldApi = {
  current: (signal?: AbortSignal) => request<CurrentWorldExpedition>('/world/expeditions/current', { signal: deadline(signal) }),
  get: (worldId: string, signal?: AbortSignal) => request<WorldExpeditionView>(`/world/expeditions/${worldId}`, { signal: deadline(signal) }),
  start: (body: { worldId: string; operationId: string }) => request<WorldCommandResult>('/world/expeditions', { body, signal: AbortSignal.timeout(15000) }),
  execute: (worldId: string, command: WorldCommand) => request<WorldCommandResult>(`/world/expeditions/${worldId}/actions`, { body: command, signal: AbortSignal.timeout(15000) }),
  operation: (worldId: string, operationId: string, signal?: AbortSignal) => request<{ state: 'pending' | 'complete'; result: WorldDeliveryResult | null }>(`/world/expeditions/${worldId}/operations/${operationId}`, { signal: deadline(signal) }),
  cargo: (characterId: string, signal?: AbortSignal) => request<WorldCargoDocument[]>(`/world/cargo?${new URLSearchParams({ characterId })}`, { signal: deadline(signal) }),
  claim: (manifestId: string, body: { operationId: string; characterId: string }) => request<CargoImportProof>(`/world/cargo/${encodeURIComponent(manifestId)}/claim`, { body, signal: AbortSignal.timeout(15000) }),
};
