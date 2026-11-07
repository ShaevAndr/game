import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccountSession, CHAT_WORLD_STREAM, ChatFeed, ChatMessage, ChatView, chatSendSchema, directChatStream, mergeChatStreams } from '@game/core';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { IdentityService } from '../../identity/application/identity.service';
import { CharactersService } from '../../characters/application/characters.service';
import { ChatRepository } from '../ports/chat.repository';
import { ChatEvents } from '../ports/chat-events';
import { ChatClock } from '../ports/chat-clock';

const feedQuery = z.object({ view: z.enum(['all', 'world', 'direct']).default('all'), limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().max(4096).optional(), after: z.string().max(4096).optional() }).strict().refine(query => !(query.before && query.after));
const cursorSchema = z.object({ playerId: z.string().uuid(), view: z.enum(['all', 'world', 'direct']), mode: z.enum(['before', 'after']), offsets: z.record(z.string(), z.number().int().nonnegative().max(2147483647)) }).strict();
type Cursor = z.infer<typeof cursorSchema>;
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(ChatRepository) private readonly repository: ChatRepository,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(ChatEvents) private readonly events: ChatEvents,
    @Inject(ChatClock) private readonly clock: ChatClock) {}

  async send(session: AccountSession, body: unknown) {
    const input = chatSendSchema.parse(body), signature = JSON.stringify(input);
    const result = await this.transactions.run(async context => {
      const receipt = await this.repository.claim(session.account.id, input.operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException({ code: 'CHAT_OPERATION_CONFLICT', message: 'Этот ключ уже использован для другого сообщения' });
      if (receipt.message) return { message: receipt.message, replayed: true };
      if (session.characterId !== input.authorCharacterId) throw new ForbiddenException('Выберите персонажа, от имени которого отправляете сообщение');
      const author = await this.characters.identity(input.authorCharacterId);
      if (author.accountId !== session.account.id) throw new ForbiddenException('Персонаж не принадлежит аккаунту');
      const recipient = input.destination.kind === 'direct' ? await this.identity.getAccount(input.destination.recipientPlayerId) : undefined;
      if (recipient?.id === session.account.id) throw new BadRequestException({ code: 'CHAT_INVALID_MESSAGE', message: 'Выберите другого адресата' });
      const own = directChatStream(session.account.id);
      const deliveryKeys = recipient ? [own, directChatStream(recipient.id)] : [CHAT_WORLD_STREAM];
      // Every send locks the sender's inbox, including world messages: one limit across channels.
      const streams = await this.repository.lockStreams([...deliveryKeys, own], context);
      const now = this.clock.now();
      if (await this.repository.recentCount(session.account.id, now - 10000, context) >= 5) {
        throw new HttpException({ code: 'CHAT_RATE_LIMITED', message: 'Не больше пяти сообщений за 10 секунд', retryAfter: 10 }, 429);
      }
      const message: ChatMessage = { id: randomUUID(), operationId: input.operationId, senderPlayerId: session.account.id,
        authorCharacterId: author.id, authorName: author.name, senderName: session.account.name,
        channel: input.destination.kind, recipientPlayerId: recipient?.id ?? null, recipientName: recipient?.name ?? null,
        createdAt: new Date(now).toISOString(), segments: input.segments };
      await this.repository.save(message, streams.filter(stream => deliveryKeys.includes(stream.key)), context);
      return { message, replayed: false };
    });
    if (!result.replayed) {
      try { await this.events.publish(result.message); }
      catch { this.logger.warn('Chat push failed; committed message remains available through REST'); }
    }
    return result;
  }

  async feed(playerId: string, rawQuery: unknown): Promise<ChatFeed> {
    const query = feedQuery.parse(rawQuery), view: ChatView = query.view;
    const keys = view === 'world' ? [CHAT_WORLD_STREAM] : view === 'direct' ? [directChatStream(playerId)] : [CHAT_WORLD_STREAM, directChatStream(playerId)];
    const heads = await this.repository.heads(keys);
    const mode = query.after ? 'after' : 'before';
    let offsets = mode === 'after' ? Object.fromEntries(keys.map(key => [key, 0])) : { ...heads };
    const rawCursor = query.after ?? query.before;
    if (rawCursor) {
      try {
        const cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')));
        if (cursor.playerId !== playerId || cursor.view !== view || cursor.mode !== mode
          || Object.keys(cursor.offsets).length !== keys.length || keys.some(key => cursor.offsets[key] === undefined || cursor.offsets[key] > heads[key])) throw new Error('Invalid cursor');
        offsets = cursor.offsets;
      } catch { throw new GoneException({ code: 'CHAT_CURSOR_EXPIRED', message: 'Загрузите историю чата заново' }); }
    }
    const batches = await Promise.all(keys.map(key => this.repository.entries(key, mode === 'after' ? offsets[key] : 0,
      mode === 'after' ? heads[key] : offsets[key], mode, query.limit + 1)));
    const merged = mergeChatStreams(batches, query.limit, mode);
    const next = { ...offsets };
    for (const entry of merged.entries) next[entry.streamKey] = mode === 'after' ? entry.sequence : entry.sequence - 1;
    const after = encode({ playerId, view, mode: 'after', offsets: mode === 'after' ? next : heads });
    const before = encode({ playerId, view, mode: 'before', offsets: mode === 'before' ? next : heads });
    const messages = merged.entries.map(entry => entry.message).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { messages, after, before, hasMore: merged.hasMore };
  }
}
