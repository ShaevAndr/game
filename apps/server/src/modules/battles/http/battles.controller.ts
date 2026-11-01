import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { BattlesService } from '../application/battles.service';
import { battleView } from './battle-view';

const idSchema = z.string().uuid();

@Controller('battles')
export class BattlesController {
  constructor(@Inject(BattlesService) private readonly service: BattlesService) {}
  @Get() async list() { return (await this.service.list()).map(battleView); }
  @Get(':id') async get(@Param('id') id: string) { return battleView(await this.service.get(idSchema.parse(id))); }
  @Post() async create(@Body() body: unknown) { return battleView(await this.service.create(body)); }
  @Post(':id/join') async join(@Param('id') id: string, @Body() body: unknown) { return battleView(await this.service.join(idSchema.parse(id), body)); }
  @Post(':id/start') async start(@Param('id') id: string, @Body() body: unknown) { return battleView(await this.service.start(idSchema.parse(id), body)); }
  @Post(':id/actions') async command(@Param('id') id: string, @Body() body: unknown) { return battleView(await this.service.command(idSchema.parse(id), body)); }
}
