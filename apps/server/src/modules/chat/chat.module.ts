import { SocialModule } from '../social/social.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { CharactersModule } from '../characters/characters.module';
import { ChatService } from './application/chat.service';
import { ChatRepository } from './ports/chat.repository';
import { ChatEvents } from './ports/chat-events';
import { ChatClock } from './ports/chat-clock';
import { PostgresChatRepository } from './repositories/postgres-chat.repository';
import { SystemChatClock } from './repositories/system-chat-clock';
import { ChatController } from './http/chat.controller';
import { ChatGateway } from './http/chat.gateway';

@Module({ imports: [DatabaseModule, IdentityModule, CharactersModule, SocialModule], controllers: [ChatController],
  providers: [ChatService, ChatGateway, { provide: ChatRepository, useClass: PostgresChatRepository },
    { provide: ChatEvents, useExisting: ChatGateway }, { provide: ChatClock, useClass: SystemChatClock }], exports: [ChatService] })
export class ChatModule {}
