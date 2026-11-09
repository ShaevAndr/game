import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../../../shared/http/service-token.guard';
import { WorldService } from '../application/world.service';

@Controller('world/expeditions')
@UseGuards(ServiceTokenGuard)
export class WorldController {
  constructor(@Inject(WorldService) private readonly service: WorldService) {}
  @Get(':id') get(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: unknown) { return this.service.get(id, query); }
  @Get(':id/manifests') manifests(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: unknown) { return this.service.manifests(id, query); }
}

@Controller('world/health')
export class WorldHealthController {
  constructor(@Inject(WorldService) private readonly service: WorldService) {}
  @Get() health() { return this.service.health(); }
}
