import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { OwnResources } from '../../../shared/http/account-access';
import { GatheringService } from '../application/gathering.service';

@OwnResources({ kind: 'character', from: 'params', key: 'id' })
@Controller('characters/:id/gathering')
export class GatheringController {
  constructor(@Inject(GatheringService) private readonly service: GatheringService) {}
  @Get() get(@Param('id') id: string) { return this.service.get(z.string().uuid().parse(id)); }
  @Post('actions') execute(@Param('id') id: string, @Body() input: unknown) { return this.service.execute(z.string().uuid().parse(id), input); }
}
