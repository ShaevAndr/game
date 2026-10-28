import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ItemsService } from '../application/items.service';

@Controller('items')
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly service: ItemsService) {}
  @Get('groups') groups() { return this.service.groups(); }
  @Get() list() { return this.service.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(id); }
}
