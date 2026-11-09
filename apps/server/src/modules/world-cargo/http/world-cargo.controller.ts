import { Body, Controller, Get, Inject, Param, Post, Query, Req, Injectable, type OnModuleInit } from '@nestjs/common';
import { cargoOfferSchema } from '@game/core';
import type { AccountRequest } from '../../../shared/http/account-access';
import { MessageBus, MessageFailure } from '../../../shared/application/message-bus';
import { handleMessage } from '../../../shared/http/message-handler';
import { WorldCargoService } from '../application/world-cargo.service';
@Controller('world/cargo')
export class WorldCargoController {
  constructor(@Inject(WorldCargoService) private readonly service: WorldCargoService) {}
  @Get() list(@Req() request: AccountRequest, @Query('characterId') characterId: string) { return this.service.list(request.identity!, characterId); }
  @Post(':id/claim') claim(@Req() request: AccountRequest, @Param('id') id: string, @Body() body: unknown) { return this.service.claim(request.identity!, id, body); }
}
@Injectable()
export class WorldCargoMessageController implements OnModuleInit {
  constructor(@Inject(MessageBus) private readonly bus: MessageBus, @Inject(WorldCargoService) private readonly service: WorldCargoService) {}
  onModuleInit() {
    this.bus.handle('inventory.import-expedition-cargo', 'world', (payload, context) => handleMessage(async () => {
      const offer = cargoOfferSchema.parse(payload);
      if (context.id !== `${offer.manifest.id}:offer`) throw new MessageFailure('ID сообщения не соответствует манифесту', false, 'MESSAGE_ID');
      return this.service.accept(offer);
    }));
  }
}
