import { Inject, Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Battle } from '@game/core';
import { z } from 'zod';
import { BattleEvents } from '../ports/battle-events';
import { battleView } from './battle-view';
import { IdentityService } from '../../identity/application/identity.service';

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
export class BattlesGateway extends BattleEvents {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) { super(); }
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(BattlesGateway.name);

  @SubscribeMessage('watch')
  async watch(@ConnectedSocket() socket: Socket, @MessageBody() value: unknown) {
    try { await this.identity.authenticate(socket.handshake.auth?.token); }
    catch { return { error: 'Выберите аккаунт' }; }
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
    try { this.server?.to(battle.id).emit('battle', battleView(battle)); }
    catch { this.logger.warn(`Battle ${battle.id}: realtime delivery failed; snapshot is available via REST`); }
  }
}
