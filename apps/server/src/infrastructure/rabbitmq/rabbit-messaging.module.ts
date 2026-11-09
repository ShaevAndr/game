import { Module } from '@nestjs/common';
import { MessageBus } from '../../shared/application/message-bus';
import { RabbitMessageBus } from './rabbit-message-bus';
@Module({ providers: [{ provide: MessageBus, useClass: RabbitMessageBus }], exports: [MessageBus] })
export class RabbitMessagingModule {}
