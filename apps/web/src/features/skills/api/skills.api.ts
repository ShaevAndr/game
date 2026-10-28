import { Character, Skill } from '@game/core';
import { request } from '../../../shared/api/http';

export const skillsApi = {
  upgrade: (characterId: string, skillId: string, expectedLevel: number) => request<Character>(`/characters/${characterId}/skills/${skillId}/upgrade`, { body: { expectedLevel } }),
  list: () => request<Skill[]>('/skills'),
  learn: (characterId: string, skillId: string) => request<Character>(`/characters/${characterId}/skills`, { body: { skillId } }),
};
