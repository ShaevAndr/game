import type { Account, AccountLogin, AccountSession } from '@game/core';
import { request } from '../../../shared/api/http';

export const identityApi = {
  list: (signal?: AbortSignal) => request<Account[]>('/accounts', { signal }),
  create: (name: string) => request<Account>('/accounts', { body: { name } }),
  login: (accountId: string) => request<AccountLogin>('/identity/session', { body: { accountId } }),
  current: (signal?: AbortSignal) => request<AccountSession>('/identity/session', { signal }),
  selectCharacter: (characterId: string | null) => request<AccountSession>('/identity/session/character', { body: { characterId } }),
  logout: () => request<{ ok: true }>('/identity/session', { method: 'DELETE' }),
};
