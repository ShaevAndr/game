import { Content } from '@game/core';
import { request } from '../../../shared/api/http';

export const contentApi = { get: () => request<Content>('/content') };
