import { SocialService } from '../../social/application/social.service';
import { Inject } from '@nestjs/common';
import { ConnectedSocket, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import type { ChatMessage } from '@game/core';
import { IdentityService } from '../../identity/application/identity.service';
import { ChatEvents } from '../ports/chat-events';

/** Push invalidates the feed; private text is always fetched through authorized REST. */
@WebSocketGateway({ namespace: '/chat', cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
export class ChatGateway extends ChatEvents {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService, @Inject(SocialService) private readonly social: SocialService) { super(); }
  @WebSocketServer() server!: Namespace;
  @SubscribeMessage('subscribe') async subscribe(@ConnectedSocket() socket: Socket) {
    try { await this.identity.authenticate(socket.handshake.auth?.token); socket.data.chatSubscribed = true; return { ok: true }; }
    catch { socket.data.chatSubscribed = false; return { error: 'Выберите аккаунт' }; }
  }
  async publish(message: ChatMessage) {
    if (!this.server) return;
    await Promise.all([...this.server.sockets.values()].filter(socket => socket.data.chatSubscribed).map(async socket => {
      try {
        const session = await this.identity.authenticate(socket.handshake.auth?.token);
        if (!await this.social.canSeeAuthor(session.account.id, message.senderPlayerId)) return;
        if (message.channel === 'world' || session.account.id === message.senderPlayerId || session.account.id === message.recipientPlayerId) {
          socket.emit('message.created', { messageId: message.id, channel: message.channel });
        }
      } catch { socket.disconnect(true); }
    }));
  }
}
