import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { worldDeliverySchema, cargoImportProofSchema } from '@game/core';
import { MessageBus, MessageFailure } from '../../../shared/application/message-bus';
import { handleMessage } from '../../../shared/http/message-handler';
import { WorldDeliveryService } from '../application/world-delivery.service';
import { WorldCargoService } from '../application/world-cargo.service';
@Injectable()
export class WorldMessageController implements OnModuleInit {
  constructor(@Inject(MessageBus) private readonly bus: MessageBus, @Inject(WorldDeliveryService) private readonly worlds: WorldDeliveryService,
    @Inject(WorldCargoService) private readonly cargo: WorldCargoService) {}
  onModuleInit() {
    this.bus.handle('world.deliver', 'server', (payload, context) => handleMessage(async () => {
      const delivery = worldDeliverySchema.parse(payload);
      if (delivery.id !== context.id) throw new MessageFailure('ID сообщения не соответствует допуску', false, 'MESSAGE_ID');
      return this.worlds.deliver(delivery);
    }));
    this.bus.handle('inventory.cargo-imported', 'server', (payload, context) => handleMessage(async () => {
      const proof = cargoImportProofSchema.parse(payload);
      if (context.id !== `${proof.manifestId}:imported`) throw new MessageFailure('ID подтверждения не соответствует грузу', false, 'MESSAGE_ID');
      return this.cargo.imported(proof);
    }));
  }
}
