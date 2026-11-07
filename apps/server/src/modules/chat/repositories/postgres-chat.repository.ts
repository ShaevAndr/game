import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChatEntry, ChatMessage } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { ChatRepository, ChatStream } from '../ports/chat.repository';

@Injectable()
export class PostgresChatRepository extends ChatRepository {
  constructor(@Inject(Database) private readonly database: Database) { super(); }
  async claim(senderId: string, operationId: string, signature: string, context: TransactionContext) {
    const tx = this.database.session(context);
    await tx.insertInto('chat_operations').values({ sender_id: senderId, operation_id: operationId, signature, result: null })
      .onConflict(conflict => conflict.columns(['sender_id', 'operation_id']).doNothing()).execute();
    const row = await tx.selectFrom('chat_operations').selectAll().where('sender_id', '=', senderId).where('operation_id', '=', operationId).forUpdate().executeTakeFirstOrThrow();
    return { signature: row.signature, message: row.result };
  }
  async lockStreams(keys: string[], context: TransactionContext) {
    const tx = this.database.session(context), streams: ChatStream[] = [];
    for (const key of [...new Set(keys)].sort()) {
      await tx.insertInto('chat_streams').values({ id: randomUUID(), stream_key: key, last_sequence: 0 })
        .onConflict(conflict => conflict.column('stream_key').doNothing()).execute();
      const row = await tx.selectFrom('chat_streams').selectAll().where('stream_key', '=', key).forUpdate().executeTakeFirstOrThrow();
      streams.push({ id: row.id, key: row.stream_key, sequence: row.last_sequence });
    }
    return streams;
  }
  async recentCount(senderId: string, since: number, context: TransactionContext) {
    const row = await this.database.session(context).selectFrom('chat_messages').select(eb => eb.fn.countAll().as('count'))
      .where('sender_id', '=', senderId).where('created_at', '>', new Date(since)).executeTakeFirstOrThrow();
    return Number(row.count);
  }
  async save(message: ChatMessage, streams: ChatStream[], context: TransactionContext) {
    const tx = this.database.session(context);
    await tx.insertInto('chat_messages').values({ id: message.id, sender_id: message.senderPlayerId, created_at: new Date(message.createdAt), data: JSON.stringify(message) }).execute();
    for (const stream of streams) {
      const sequence = stream.sequence + 1;
      await tx.updateTable('chat_streams').set({ last_sequence: sequence }).where('id', '=', stream.id).execute();
      await tx.insertInto('chat_deliveries').values({ stream_id: stream.id, sequence, message_id: message.id }).execute();
    }
    await tx.updateTable('chat_operations').set({ result: JSON.stringify(message) })
      .where('sender_id', '=', message.senderPlayerId).where('operation_id', '=', message.operationId).execute();
  }
  async heads(keys: string[]) {
    const rows = await this.database.sql.selectFrom('chat_streams').select(['stream_key', 'last_sequence']).where('stream_key', 'in', keys).execute();
    return Object.fromEntries(keys.map(key => [key, rows.find(row => row.stream_key === key)?.last_sequence ?? 0]));
  }
  async entries(key: string, from: number, to: number, direction: 'before' | 'after', limit: number): Promise<ChatEntry[]> {
    const rows = await this.database.sql.selectFrom('chat_deliveries').innerJoin('chat_streams', 'chat_streams.id', 'chat_deliveries.stream_id')
      .innerJoin('chat_messages', 'chat_messages.id', 'chat_deliveries.message_id').select(['chat_deliveries.sequence', 'chat_messages.data'])
      .where('chat_streams.stream_key', '=', key).where('sequence', '>', from).where('sequence', '<=', to)
      .orderBy('sequence', direction === 'before' ? 'desc' : 'asc').limit(limit).execute();
    return rows.map(row => ({ streamKey: key, sequence: row.sequence, message: row.data }));
  }
}
