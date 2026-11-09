import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage, type Options } from 'amqplib';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { MessageFailure, type MessageContext, type MessageHandler, type MessagePeer } from './contracts';

interface RequestData extends MessageContext { version: 1; payload: unknown }
interface ReplyData { id: string; producer: MessagePeer; requestHash: string; ok: boolean; value?: unknown; error?: { message: string; retryable: boolean; code: string } }
interface Session { connection: ChannelModel; channel: ConfirmChannel; replyQueue: string; consumer?: string }
export interface RabbitOptions {
  url: () => string | undefined; secret: () => string | undefined; namespace: () => string; producer: MessagePeer;
  timeoutMs?: number; retryDelayMs?: number; maxAttempts?: number; log?: (message: string) => void;
}
const peer = (value: unknown): value is MessagePeer => value === 'server' || value === 'world';
const digest = (body: string) => createHash('sha256').update(body).digest('hex');

/** The database journals own delivery and inbox durability. AMQP confirms only broker acceptance. */
export class RabbitRpc {
  private session?: Session;
  private opening?: Promise<Session>;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;
  private readonly handlers = new Map<string, { producer: MessagePeer; handle: MessageHandler }>();
  private readonly requests = new Map<string, { hash: string; id: string; producer: MessagePeer; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly work = new Set<Promise<void>>();
  constructor(private readonly options: RabbitOptions) {}
  enabled() { return !!this.options.url() && Buffer.byteLength(this.options.secret() ?? '') >= 32; }
  queue(destination: MessagePeer) {
    const namespace = this.options.namespace();
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(namespace)) throw new MessageFailure('Invalid RabbitMQ namespace', false, 'MESSAGE_CONFIG');
    return `${namespace}.${destination}.requests`;
  }
  handle(type: string, producer: MessagePeer, handler: MessageHandler) {
    if (this.handlers.has(type)) throw new Error(`Duplicate message handler ${type}`);
    this.handlers.set(type, { producer, handle: handler });
    return () => { this.handlers.delete(type); };
  }
  start() {
    const run = () => {
      if (this.stopped || this.checking || !this.enabled()) return;
      this.checking = this.ensure().then(() => {}).catch(() => {}).finally(() => { this.checking = undefined; });
    };
    if (!this.timer) { this.timer = setInterval(run, 1000); this.timer.unref(); } run();
  }
  private pack(value: unknown): Buffer {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 256 * 1024) throw new MessageFailure('Message exceeds 256 KiB', false, 'MESSAGE_TOO_LARGE');
    const packet = Buffer.from(JSON.stringify({ body, signature: createHmac('sha256', this.options.secret()!).update(body).digest('hex') }));
    if (packet.length > 300 * 1024) throw new MessageFailure('Signed message exceeds size limit', false, 'MESSAGE_TOO_LARGE');
    return packet;
  }
  private unpack<T>(content: Buffer): T {
    if (content.length > 300 * 1024) throw new MessageFailure('Message exceeds size limit', false, 'MESSAGE_INVALID');
    try {
      const packet = JSON.parse(content.toString()) as { body?: unknown; signature?: unknown };
      if (typeof packet.body !== 'string' || typeof packet.signature !== 'string' || !/^[a-f0-9]{64}$/.test(packet.signature)) throw new Error('Malformed envelope');
      const signature = createHmac('sha256', this.options.secret()!).update(packet.body).digest();
      if (!timingSafeEqual(signature, Buffer.from(packet.signature, 'hex'))) throw new Error('Invalid producer signature');
      return JSON.parse(packet.body) as T;
    } catch { throw new MessageFailure('Invalid signed message', false, 'MESSAGE_INVALID'); }
  }
  private async topology(channel: ConfirmChannel, destination: MessagePeer) {
    const queue = this.queue(destination);
    await channel.assertQueue(`${queue}.failed`, { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.assertQueue(`${queue}.retry`, { durable: true, arguments: {
      'x-message-ttl': this.options.retryDelayMs ?? 1000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue,
    } });
  }
  private async ensure(): Promise<Session> {
    if (this.stopped || !this.enabled()) throw new MessageFailure('RabbitMQ transport is not configured');
    if (this.session) return this.session;
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async open(): Promise<Session> {
    let connection: ChannelModel | undefined;
    try {
      const address = new URL(this.options.url()!); if (!address.searchParams.has('heartbeat')) address.searchParams.set('heartbeat', '10');
      connection = await connect(address.toString(), { timeout: 2000 });
      connection.on('error', () => {});
      const channel = await connection.createConfirmChannel(); channel.on('error', () => {}); channel.setMaxListeners(512);
      const session: Session = { connection, channel, replyQueue: '' };
      const closed = () => {
        if (this.session !== session) return;
        this.session = undefined; void connection!.close().catch(() => {});
        for (const [key, request] of this.requests) { clearTimeout(request.timer); request.reject(new MessageFailure('RabbitMQ connection closed; result unknown')); this.requests.delete(key); }
      };
      connection.once('close', closed); channel.once('close', closed);
      await this.topology(channel, 'server'); await this.topology(channel, 'world');
      session.replyQueue = (await channel.assertQueue('', { durable: false, exclusive: true, autoDelete: true })).queue;
      await channel.consume(session.replyQueue, message => {
        if (!message) return;
        const key = message.properties.correlationId, pending = this.requests.get(key ?? '');
        if (!pending) return;
        try {
          const reply = this.unpack<ReplyData>(message.content);
          if (reply.id !== pending.id || reply.producer !== pending.producer || reply.requestHash !== pending.hash || typeof reply.ok !== 'boolean') throw new Error('Mismatched reply');
          clearTimeout(pending.timer); this.requests.delete(key!);
          if (reply.ok) pending.resolve(reply.value);
          else pending.reject(new MessageFailure(reply.error?.message ?? 'Message failed', reply.error?.retryable !== false, reply.error?.code));
        } catch { this.options.log?.('Ignored an invalid RPC reply'); }
      }, { noAck: true });
      await channel.prefetch(4);
      session.consumer = (await channel.consume(this.queue(this.options.producer), message => {
        if (!message) { void channel.close().catch(() => {}); return; }
        const work = this.consume(session, message).catch(error => {
          this.options.log?.(`RabbitMQ delivery interrupted: ${(error as Error).message}`);
          // Closing requeues the unacknowledged request; no in-memory acknowledgement is assumed.
          void connection!.close().catch(() => {});
        });
        this.work.add(work); void work.finally(() => this.work.delete(work));
      }, { noAck: false })).consumerTag;
      if (this.stopped) { await connection.close(); throw new MessageFailure('Transport stopped'); }
      this.session = session; return session;
    } catch {
      if (connection) await connection.close().catch(() => {});
      this.options.log?.('RabbitMQ unavailable; retrying through the durable journal');
      throw new MessageFailure('RabbitMQ unavailable');
    }
  }
  private publish(session: Session, queue: string, content: Buffer, properties: Options.Publish = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const publication = randomUUID(); let returned = false;
      const cleanup = () => { clearTimeout(timer); session.channel.off('return', onReturn); session.channel.off('close', onClose); };
      const onReturn = (message: ConsumeMessage) => { if (message.properties.headers?.['x-publication-id'] === publication) returned = true; };
      const onClose = () => { cleanup(); reject(new MessageFailure('RabbitMQ publish interrupted')); };
      const timer = setTimeout(() => { cleanup(); reject(new MessageFailure('RabbitMQ publisher confirm timed out')); void session.connection.close().catch(() => {}); }, 5000);
      session.channel.on('return', onReturn); session.channel.once('close', onClose);
      try {
        session.channel.sendToQueue(queue, content, { ...properties, mandatory: true, contentType: 'application/json', persistent: true,
          headers: { ...properties.headers, 'x-publication-id': publication } }, error => {
          cleanup();
          if (error) reject(new MessageFailure('RabbitMQ rejected publication'));
          else if (returned) reject(new MessageFailure('RabbitMQ message was unroutable', true, 'MESSAGE_UNROUTABLE'));
          else resolve();
        });
      } catch { cleanup(); reject(new MessageFailure('RabbitMQ publish failed')); }
    });
  }
  async request(destination: MessagePeer, type: string, id: string, payload: unknown): Promise<unknown> {
    const session = await this.ensure();
    if (this.requests.size >= 128) throw new MessageFailure('Too many pending RabbitMQ requests');
    const correlationId = randomUUID(), data: RequestData = { version: 1, id, type, producer: this.options.producer, payload };
    const content = this.pack(data), hash = digest(JSON.stringify(data));
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(correlationId); reject(new MessageFailure('RabbitMQ reply timed out; result unknown')); }, this.options.timeoutMs ?? 5000);
      this.requests.set(correlationId, { id, hash, producer: destination, resolve, reject, timer });
    });
    // A publish error and a lost reply are both unknown outcomes to the caller.
    void this.publish(session, this.queue(destination), content, { correlationId, replyTo: session.replyQueue, messageId: id, type }).catch(error => {
      const pending = this.requests.get(correlationId); if (pending) { clearTimeout(pending.timer); this.requests.delete(correlationId); pending.reject(error); }
    });
    return response;
  }
  private async consume(session: Session, message: ConsumeMessage) {
    let data: RequestData | undefined, value: unknown, failure: MessageFailure | undefined;
    try {
      data = this.unpack<RequestData>(message.content);
      if (data.version !== 1 || typeof data.id !== 'string' || !data.id || data.id.length > 200 || !peer(data.producer)
        || typeof data.type !== 'string' || message.properties.messageId !== data.id) throw new MessageFailure('Invalid request envelope', false, 'MESSAGE_INVALID');
      const handler = this.handlers.get(data.type);
      if (!handler) throw new MessageFailure('No handler for message type', true, 'MESSAGE_HANDLER_UNAVAILABLE');
      if (handler.producer !== data.producer) throw new MessageFailure('Producer is not permitted', false, 'MESSAGE_PRODUCER');
      value = await handler.handle(data.payload, { id: data.id, type: data.type, producer: data.producer });
    } catch (error) {
      failure = error instanceof MessageFailure ? error : new MessageFailure('Message processing failed');
      this.options.log?.(`${data?.type ?? 'invalid'} ${data?.id ?? 'unknown'}: ${(error as Error).message}`);
    }
    if (failure) {
      const attempt = Number(message.properties.headers?.['x-attempt'] ?? 1);
      const queue = this.queue(this.options.producer);
      if (failure.retryable && Number.isSafeInteger(attempt) && attempt < (this.options.maxAttempts ?? 5)) {
        await this.publish(session, `${queue}.retry`, message.content, { ...message.properties, headers: { ...message.properties.headers, 'x-attempt': attempt + 1 } });
        session.channel.ack(message); return;
      }
      await this.publish(session, `${queue}.failed`, message.content, { ...message.properties, headers: { ...message.properties.headers,
        'x-failure-code': failure.code, 'x-final-attempt': attempt } });
    }
    if (data && message.properties.replyTo && message.properties.correlationId) {
      const reply: ReplyData = { id: data.id, producer: this.options.producer, requestHash: digest(JSON.stringify(data)), ok: !failure,
        ...(failure ? { error: { message: failure.message, retryable: failure.retryable, code: failure.code } } : { value }) };
      try { await this.publish(session, message.properties.replyTo, this.pack(reply), { correlationId: message.properties.correlationId, messageId: data.id }); }
      catch (error) {
        if (!(error instanceof MessageFailure) || error.code !== 'MESSAGE_UNROUTABLE') throw error;
        this.options.log?.(`RPC reply expired for ${data.id}; application receipt retained`);
      }
    }
    // Application commit (or confirmed failure quarantine) precedes consumer acknowledgement.
    session.channel.ack(message);
  }
  async close() {
    this.stopped = true; if (this.timer) clearInterval(this.timer);
    await this.opening?.catch(() => {});
    const session = this.session;
    if (session?.consumer) await session.channel.cancel(session.consumer).catch(() => {});
    await Promise.allSettled(this.work);
    if (session) await session.connection.close().catch(() => {});
    this.session = undefined;
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(new MessageFailure('Transport stopped; result unknown')); }
    this.requests.clear();
  }
}
