import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { AccountRequest } from '../../../shared/http/account-access';
import { WorldGatewayService } from '../application/world-gateway.service';
@Controller('world/expeditions')
export class WorldGatewayController {
  constructor(@Inject(WorldGatewayService) private readonly service: WorldGatewayService) {}
  @Post() start(@Req() request: AccountRequest, @Body() body: unknown) { return this.service.start(request.identity!, body); }
  @Get('current') current(@Req() request: AccountRequest) { return this.service.current(request.identity!); }
  @Get(':id') get(@Req() request: AccountRequest, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.get(request.identity!, id); }
  @Post(':id/actions') execute(@Req() request: AccountRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.service.execute(request.identity!, id, body); }
  @Get(':id/manifests') manifests(@Req() request: AccountRequest, @Param('id', new ParseUUIDPipe()) id: string, @Query('characterId') characterId: string) {
    return this.service.manifests(request.identity!, id, characterId);
  }
  @Get(':id/operations/:operationId') operation(@Req() request: AccountRequest, @Param('id', new ParseUUIDPipe()) id: string,
    @Param('operationId', new ParseUUIDPipe()) operationId: string) { return this.service.operation(request.identity!, id, operationId); }
}
