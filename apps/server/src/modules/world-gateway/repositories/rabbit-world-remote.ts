import { Inject, Injectable, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { worldDeliveryResultSchema, type WorldDelivery, type WorldIdentity } from '@game/core';
import { WorldRemote } from '../ports/world-remote';
import { MessageBus } from '../../../shared/application/message-bus';
@Injectable()
export class RabbitWorldRemote extends WorldRemote {
  constructor(@Inject(MessageBus) private readonly bus: MessageBus) { super(); }
  enabled() { return this.bus.enabled() && !!process.env.WORLD_URL && Buffer.byteLength(process.env.WORLD_SERVICE_TOKEN ?? '') >= 32; }
  private async call(path: string, body?: unknown) {
    if (!this.enabled()) throw new ServiceUnavailableException('Сервис мира не настроен');
    try {
      const response = await fetch(`${process.env.WORLD_URL!.replace(/\/$/, '')}/api/v1/world${path}`, {
        method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${process.env.WORLD_SERVICE_TOKEN}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
      });
      const value = await response.json();
      if (!response.ok) throw new HttpException({ message: typeof value.message === 'string' ? value.message : 'Сервис мира отклонил запрос' }, response.status);
      return value;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Сервис мира недоступен');
    }
  }
  async deliver(delivery: WorldDelivery) {
    const result = worldDeliveryResultSchema.parse(await this.bus.request('world', 'world.deliver', delivery.id, delivery));
    if ('worldId' in result.body && result.body.worldId !== delivery.worldId) throw new ServiceUnavailableException('Неверный ответ сервиса мира');
    const expectedOperation = delivery.payload.kind === 'action' ? delivery.payload.request.command.operationId
      : delivery.payload.kind === 'start' ? delivery.payload.operationId : delivery.id;
    if ('operationId' in result.body && result.body.operationId !== expectedOperation) throw new ServiceUnavailableException('Неверная квитанция сервиса мира');
    return result;
  }
  read(worldId: string, identity: WorldIdentity) { return this.call(`/expeditions/${worldId}?${new URLSearchParams({ ...identity })}`); }
  manifests(worldId: string, playerId: string, characterId: string) {
    return this.call(`/expeditions/${worldId}/manifests?${new URLSearchParams({ playerId, characterId })}`);
  }
}
