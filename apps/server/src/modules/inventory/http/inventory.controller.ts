import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAccount, OwnResources } from '../../../shared/http/account-access';
import { Account, InventoryCommand } from '@game/core';
import { InventoryService } from '../application/inventory.service';

const id = z.string().uuid();
const quantity = z.number().int().min(1).max(99999);
const operation = { operationId: id };
const itemActionSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('remove'), quantity }).strict(),
  z.object({ ...operation, action: z.literal('split'), quantity }).strict(),
  z.object({ ...operation, action: z.literal('merge'), targetInstanceId: id }).strict(),
  z.object({ ...operation, action: z.literal('equip') }).strict(),
  z.object({ ...operation, action: z.literal('unequip') }).strict(),
  z.object({ ...operation, action: z.literal('read') }).strict(),
]);

@Controller()
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly service: InventoryService) {}
  @OwnResources({ kind: 'character', from: 'params', key: 'id' })
  @Get('characters/:id/inventory') stacks(@Param('id') ownerId: string) { return this.service.stacks(id.parse(ownerId)); }
  @OwnResources({ kind: 'character', from: 'params', key: 'id' })
  @Get('characters/:id/inventories') get(@Param('id') ownerId: string) { return this.service.get(id.parse(ownerId)); }
  @OwnResources({ kind: 'item', from: 'params', key: 'id' })
  @Get('item-instances/:id') instance(@CurrentAccount() account: Account, @Param('id') instanceId: string) { return this.service.instance(id.parse(instanceId), account.id); }

  @Post('characters/:id/inventories') create(@CurrentAccount() account: Account, @Param('id') ownerId: string, @Body() body: unknown) {
    const { operationId, name, capacity } = z.object({ ...operation, name: z.string().trim().min(2).max(48), capacity: z.number().int().min(1).max(200).default(50) }).strict().parse(body);
    return this.service.execute({ type: 'create-inventory', ownerId: id.parse(ownerId), name, capacity }, operationId, account.id);
  }
  @Post('inventory-transfers') transfer(@CurrentAccount() account: Account, @Body() body: unknown) {
    const { operationId, ...input } = z.object({ ...operation, instanceId: id, targetInventoryId: id, quantity }).strict().parse(body);
    return this.service.execute({ type: 'transfer', ...input }, operationId, account.id);
  }
  @Post('inventories/:id/items') put(@CurrentAccount() account: Account, @Param('id') inventoryId: string, @Body() body: unknown) {
    const { operationId, ...input } = z.object({ ...operation, instanceId: id, quantity }).strict().parse(body);
    return this.service.execute({ type: 'put', targetInventoryId: id.parse(inventoryId), ...input }, operationId, account.id);
  }
  @Delete('item-instances/:id') delete(@CurrentAccount() account: Account, @Param('id') instanceId: string, @Body() body: unknown) {
    const { operationId, quantity: amount } = z.object({ ...operation, quantity }).strict().parse(body);
    return this.service.execute({ type: 'delete', instanceId: id.parse(instanceId), quantity: amount }, operationId, account.id);
  }
  @Post('item-instances/:id/actions') action(@CurrentAccount() account: Account, @Param('id') instanceId: string, @Body() body: unknown) {
    const { operationId, action, ...input } = itemActionSchema.parse(body);
    const command = { type: action, instanceId: id.parse(instanceId), ...input } as InventoryCommand;
    return this.service.execute(command, operationId, account.id);
  }
}
