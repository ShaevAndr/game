import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { OwnResources } from '../../../shared/http/account-access';
import { z } from 'zod';
import { BattlesService } from '../application/battles.service';
import { battleView } from './battle-view';

const idSchema = z.string().uuid();

@OwnResources({ kind: 'character', from: 'body', key: 'characterId' })
@Controller('battles')
export class BattlesController {
  constructor(@Inject(BattlesService) private readonly service: BattlesService) {}
  @Get() async list() { return (await this.service.list()).map(battleView); }
  @OwnResources({ kind: 'character', from: 'params', key: 'characterId' })
  @Get('arena/:characterId') arena(@Param('characterId') characterId: string) { return this.service.arenaState(idSchema.parse(characterId)); }
  @Post(':id/challenges') challenge(@Param('id') id: string, @Body() body: unknown) { return this.service.challenge(idSchema.parse(id), body); }
  @Post(':id/challenges/:challengeId/accept') async accept(@Param('id') id: string, @Param('challengeId') challengeId: string, @Body() body: unknown) {
    return battleView(await this.service.acceptChallenge(idSchema.parse(id), idSchema.parse(challengeId), body));
  }
  @Post(':id/challenges/:challengeId/dismiss') async dismiss(@Param('id') id: string, @Param('challengeId') challengeId: string, @Body() body: unknown) {
    await this.service.dismissChallenge(idSchema.parse(id), idSchema.parse(challengeId), body); return { ok: true };
  }
  @Get(':id') async get(@Param('id') id: string) { return battleView(await this.service.get(idSchema.parse(id))); }
  @Post() async create(@Body() body: unknown) { return battleView(await this.service.create(body)); }
  @Post(':id/cancel') async cancel(@Param('id') id: string, @Body() body: unknown) {
    await this.service.cancelRoom(idSchema.parse(id), body); return { ok: true };
  }
  @Post(':id/join') async join(@Param('id') id: string, @Body() body: unknown) { return battleView(await this.service.join(idSchema.parse(id), body)); }
  @Post(':id/start') async start(@Param('id') id: string, @Body() body: unknown) { return battleView(await this.service.start(idSchema.parse(id), body)); }
  @Post(':id/actions') async command(@Param('id') id: string, @Body() body: unknown) { return battleView(await this.service.command(idSchema.parse(id), body)); }
}
