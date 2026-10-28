import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Battle } from '@game/core';
import { z } from 'zod';
import { BattleEvents } from '../ports/battle-events';

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
export class BattlesGateway extends BattleEvents {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(BattlesGateway.name);

  @SubscribeMessage('watch')
  async watch(@ConnectedSocket() socket: Socket, @MessageBody() value: unknown) {
    const id = z.string().uuid().safeParse(value);
    if (!id.success) return { error: 'Некорректный ID' };
    await this.unwatch(socket);
    await socket.join(id.data);
    return { ok: true };
  }

  @SubscribeMessage('unwatch')
  async unwatch(@ConnectedSocket() socket: Socket) {
    for (const room of socket.rooms) if (room !== socket.id) await socket.leave(room);
    return { ok: true };
  }

  publish(battle: Battle) {
    try { this.server?.to(battle.id).emit('battle', battle); }
    catch { this.logger.warn(`Battle ${battle.id}: realtime delivery failed; snapshot is available via REST`); }
  }
}
