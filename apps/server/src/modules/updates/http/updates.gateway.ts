import { Inject, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { stateTopics, type AccountSession } from '@game/core';
import { z } from 'zod';
import { StateChanges, type StateChange } from '../../../shared/application/state-changes';
import { IdentityService } from '../../identity/application/identity.service';

@WebSocketGateway({ namespace: '/updates', cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
export class UpdatesGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Namespace;
  private unsubscribe?: () => void;
  private presenceTimer?: ReturnType<typeof setInterval>;
  private presenceCheck = false;
  private online = '';
  constructor(@Inject(StateChanges) private readonly changes: StateChanges,
    @Inject(IdentityService) private readonly identity: IdentityService) {}
  onModuleInit() {
    this.unsubscribe = this.changes.subscribe(change => { void this.publish(change); });
    // Presence leases can expire without an HTTP command (closed browser, lost network).
    this.presenceTimer = setInterval(() => { void this.checkPresence().catch(() => {}); }, 15_000);
    this.presenceTimer.unref();
  }
  private async checkPresence() {
    if (this.presenceCheck) return;
    this.presenceCheck = true;
    try {
      const online = (await this.identity.onlineCharacterIds()).sort().join(',');
      if (online !== this.online) { this.online = online; this.changes.publish({ topics: ['rooms'] }); }
    } finally { this.presenceCheck = false; }
  }
  onModuleDestroy() { this.unsubscribe?.(); if (this.presenceTimer) clearInterval(this.presenceTimer); }
  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    try {
      const topics = z.array(z.enum(stateTopics)).max(stateTopics.length).parse(body);
      const session = await this.identity.authenticate(socket.handshake.auth?.token);
      if (!socket.connected) return { error: 'Соединение закрыто' };
      const initial = !socket.data.session;
      socket.data.session = session; socket.data.topics = topics;
      if (initial && session.characterId) this.changes.publish({ topics: ['rooms'] });
      return { ok: true };
    } catch { socket.data.topics = []; return { error: 'Не удалось подписаться на обновления' }; }
  }
  @SubscribeMessage('heartbeat')
  async heartbeat(@ConnectedSocket() socket: Socket) {
    try { socket.data.session = await this.identity.authenticate(socket.handshake.auth?.token); return { ok: true }; }
    catch { socket.disconnect(true); return { error: 'Сессия завершена' }; }
  }
  private async publish(change: StateChange) {
    if (!this.server) return;
    await Promise.all([...this.server.sockets.values()].map(async socket => {
      const previous = socket.data.session as AccountSession | undefined;
      if (!previous || !socket.data.topics?.length) return;
      // Untargeted notifications are allowed only for the public room directory.
      const relevant = (session: AccountSession) => change.topics.filter(topic => socket.data.topics.includes(topic) &&
        (change.accountIds?.includes(session.account.id) || !!session.characterId && change.characterIds?.includes(session.characterId) ||
          topic === 'rooms' && !change.accountIds && !change.characterIds));
      if (!relevant(previous).length) return;
      try {
        const session = await this.identity.authenticate(socket.handshake.auth?.token);
        const topics = relevant(session);
        if (socket.connected && topics.length) socket.emit('state.changed', { topics });
      } catch { socket.disconnect(true); }
    }));
  }
}
