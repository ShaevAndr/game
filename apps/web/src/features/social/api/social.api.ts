import type { SocialCommand, SocialCommandResult, SocialState } from '@game/core';
import { request } from '../../../shared/api/http';
export const socialApi = {
  state: (signal?: AbortSignal) => request<SocialState>('/social', { signal }),
  command: (body: SocialCommand) => request<SocialCommandResult>('/social/actions', { body }),
};
