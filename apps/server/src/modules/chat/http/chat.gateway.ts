import { SocialService } from '../../social/application/social.service';
import { Inject } from '@nestjs/common';
import { ConnectedSocket, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import type { ChatMessage } from '@game/core';
import { IdentityService } from '../../identity/application/identity.service';
import { ChatEvents, type ChatPartyRecipient } from '../ports/chat-events';
import { PartiesService } from '../../parties/application/parties.service';
import { UnitOfWork } from '../../../shared/application/unit-of-work';

/** Push invalidates the feed; private text is always fetched through authorized REST. */
@WebSocketGateway({ namespace: '/chat', cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
export class ChatGateway extends ChatEvents {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService, @Inject(SocialService) private readonly social: SocialService,
    @Inject(PartiesService) private readonly parties: PartiesService, @Inject(UnitOfWork) private readonly transactions: UnitOfWork) { super(); }
  @WebSocketServer() server!: Namespace;
  @SubscribeMessage('subscribe') async subscribe(@ConnectedSocket() socket: Socket) {
    try { await this.identity.authenticate(socket.handshake.auth?.token); socket.data.chatSubscribed = true; return { ok: true }; }
    catch { socket.data.chatSubscribed = false; return { error: 'Выберите аккаунт' }; }
  }
  async publish(message: ChatMessage, partyRecipients?: ChatPartyRecipient[]) {
    if (!this.server) return;
    await Promise.all([...this.server.sockets.values()].filter(socket => socket.data.chatSubscribed).map(async socket => {
      try {
        const session = await this.identity.authenticate(socket.handshake.auth?.token);
        await this.transactions.run(async context => {
          const policy = await this.social.readPolicy(session.account.id, context);
          if (policy.hiddenAuthors.includes(message.senderPlayerId)) return;
          if (message.channel === 'party') {
            const recipient = partyRecipients?.find(member => member.playerId === session.account.id);
            if (!recipient) return;
            const access = await this.parties.chatAccess(session.account.id, context);
            if (access?.partyId !== message.partyId || access?.membershipId !== recipient.membershipId) return;
          } else if (message.channel !== 'world' && session.account.id !== message.senderPlayerId && session.account.id !== message.recipientPlayerId) return;
          // Membership and block locks stay held until this metadata-only emit.
          socket.emit('message.created', { messageId: message.id, channel: message.channel, ...(message.partyId ? { partyId: message.partyId } : {}) });
        });
      } catch { socket.disconnect(true); }
    }));
  }
}
