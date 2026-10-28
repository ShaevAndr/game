import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { BattlesService } from '../application/battles.service';

const idSchema = z.string().uuid();

@Controller('battles')
export class BattlesController {
  constructor(@Inject(BattlesService) private readonly service: BattlesService) {}
  @Get() list() { return this.service.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(idSchema.parse(id)); }
  @Post() create(@Body() body: unknown) { return this.service.create(body); }
  @Post(':id/join') join(@Param('id') id: string, @Body() body: unknown) { return this.service.join(idSchema.parse(id), body); }
  @Post(':id/start') start(@Param('id') id: string, @Body() body: unknown) { return this.service.start(idSchema.parse(id), body); }
  @Post(':id/actions') command(@Param('id') id: string, @Body() body: unknown) { return this.service.command(idSchema.parse(id), body); }
}
