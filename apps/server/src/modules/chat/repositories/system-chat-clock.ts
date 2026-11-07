import { Injectable } from '@nestjs/common';
import { ChatClock } from '../ports/chat-clock';
@Injectable()
export class SystemChatClock extends ChatClock { now() { return Date.now(); } }
