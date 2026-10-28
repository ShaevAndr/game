import { Character, Skill } from '@game/core';
import { request } from '../../../shared/api/http';

export const skillsApi = {
  list: () => request<Skill[]>('/skills'),
  learn: (characterId: string, skillId: string) => request<Character>(`/characters/${characterId}/skills`, { body: { skillId } }),
};
