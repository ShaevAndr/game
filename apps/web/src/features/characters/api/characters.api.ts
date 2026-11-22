import { Character } from '@game/core';
import { request } from '../../../shared/api/http';

export const charactersApi = {
  list: (signal?: AbortSignal) => request<Character[]>('/characters', { signal }),
  create: (name: string, templateId?: string) => request<Character>('/characters', { body: { name, ...(templateId ? { templateId } : {}) } }),
  allocate: (id: string, allocations: Record<string, number>, expectedRevision: number) => request<Character>(`/characters/${id}/attributes`, { body: { allocations, expectedRevision } }),
};
