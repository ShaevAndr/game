import { Character } from '@game/core';
import { request } from '../../../shared/api/http';

export const charactersApi = {
  list: () => request<Character[]>('/characters'),
  create: (name: string, templateId?: string) => request<Character>('/characters', { body: { name, ...(templateId ? { templateId } : {}) } }),
  allocate: (id: string, allocations: Record<string, number>, expectedRevision: number) => request<Character>(`/characters/${id}/attributes`, { body: { allocations, expectedRevision } }),
};
