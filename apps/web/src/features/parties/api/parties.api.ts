import type { PartyCommand, PartyCommandResult, PartyState } from '@game/core';
import { request } from '../../../shared/api/http';

export const partiesApi = {
  state: (signal?: AbortSignal) => request<PartyState>('/parties', { signal }),
  command: (command: PartyCommand) => request<PartyCommandResult>('/parties/actions', { body: command }),
};
