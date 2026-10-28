import { Controller, Get, Inject, Param } from '@nestjs/common';
import { z } from 'zod';
import { InventoryService } from '../application/inventory.service';

@Controller('characters/:id/inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly service: InventoryService) {}
  @Get() get(@Param('id') id: string) { return this.service.get(z.string().uuid().parse(id)); }
}
