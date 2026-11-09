import { Injectable, Logger, type OnModuleInit, type BeforeApplicationShutdown } from '@nestjs/common';
import { RabbitRpc } from '@game/messaging';
import { MessageBus, type MessageHandler, type MessagePeer } from '../../shared/application/message-bus';
@Injectable()
export class RabbitMessageBus extends MessageBus implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(RabbitMessageBus.name);
  readonly rpc = new RabbitRpc({ producer: 'server', url: () => process.env.RABBITMQ_URL,
    secret: () => process.env.WORLD_SERVICE_TOKEN, namespace: () => process.env.RABBITMQ_NAMESPACE ?? 'game',
    log: message => this.logger.warn(message) });
  enabled() { return this.rpc.enabled(); }
  request(peer: MessagePeer, type: string, id: string, payload: unknown) { return this.rpc.request(peer, type, id, payload); }
  handle(type: string, producer: MessagePeer, handler: MessageHandler) { return this.rpc.handle(type, producer, handler); }
  onModuleInit() { this.rpc.start(); }
  async beforeApplicationShutdown() { await this.rpc.close(); }
}
