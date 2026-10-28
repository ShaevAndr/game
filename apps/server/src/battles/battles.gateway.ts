import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Battle } from '@game/core';
@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
export class BattlesGateway {
  @WebSocketServer() server!: Server;
  @SubscribeMessage('watch')
  async watch(@ConnectedSocket() socket: Socket, @MessageBody() id: unknown) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return { error: 'Некорректный ID' };
    for (const room of socket.rooms) if (room !== socket.id) await socket.leave(room);
    await socket.join(id); return { ok: true };
  }
  publish(battle: Battle) { this.server.to(battle.id).emit('battle', battle); this.server.emit('rooms-changed'); }
}
