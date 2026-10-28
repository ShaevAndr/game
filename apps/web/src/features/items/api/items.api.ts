import { Item } from '@game/core';
import { request } from '../../../shared/api/http';

export const itemsApi = { list: () => request<Item[]>('/items') };
