import { InventoryCommand, InventoryResult, InventoryView } from '@game/core';
import { request } from '../../../shared/api/http';

export type ClientInventoryCommand = Exclude<InventoryCommand, { type: 'receive' }>;
export const inventoryApi = {
  get: (characterId: string) => request<InventoryView>(`/characters/${characterId}/inventories`),
  execute: (command: ClientInventoryCommand, operationId: string) => {
    if (command.type === 'create-inventory') return request<InventoryResult>(`/characters/${command.ownerId}/inventories`, { body: { operationId, name: command.name, capacity: command.capacity } });
    if (command.type === 'delete') return request<InventoryResult>(`/item-instances/${command.instanceId}`, { method: 'DELETE', body: { operationId, quantity: command.quantity } });
    if (command.type === 'transfer') return request<InventoryResult>('/inventory-transfers', { body: { operationId, instanceId: command.instanceId, targetInventoryId: command.targetInventoryId, quantity: command.quantity } });
    if (command.type === 'put') return request<InventoryResult>(`/inventories/${command.targetInventoryId}/items`, { body: { operationId, instanceId: command.instanceId, quantity: command.quantity } });
    const { type: action, instanceId, ...input } = command;
    return request<InventoryResult>(`/item-instances/${instanceId}/actions`, { body: { operationId, action, ...input } });
  },
};
