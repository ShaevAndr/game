import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { SessionPresence } from '../ports/session-presence';

// Replace only this session's lease: another tab can keep the same character online.
const refreshScript = `
  local previous = redis.call('GET', KEYS[2])
  if previous then redis.call('ZREM', KEYS[1], previous) end
  redis.call('DEL', KEYS[2])
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local expires = tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
  if ARGV[2] ~= '' and expires > now then
    local member = ARGV[2] .. ':' .. ARGV[1]
    redis.call('SET', KEYS[2], member, 'PX', expires - now)
    redis.call('ZADD', KEYS[1], expires, member)
    redis.call('PEXPIRE', KEYS[1], 60000)
  end
`;

@Injectable()
export class RedisSessionPresence extends SessionPresence implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisSessionPresence.name);
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
    connectTimeout: 2000, commandTimeout: 2000,
  });
  private readonly prefix = `${process.env.REDIS_NAMESPACE ?? 'game'}:identity:presence`;

  constructor() {
    super();
    this.client.on('error', () => this.logger.warn('Redis presence unavailable; arena rooms are hidden'));
  }
  async onModuleInit() {
    try { await this.client.connect(); } catch { /* Presence recovers when Redis reconnects. */ }
  }
  async refresh(sessionHash: string, characterId: string | null, expiresAt: number) {
    if (this.client.status !== 'ready') return;
    try { await this.client.eval(refreshScript, 2, this.prefix, `${this.prefix}:${sessionHash}`, sessionHash, characterId ?? '', expiresAt); }
    catch { this.logger.warn('Failed to refresh session presence'); }
  }
  async onlineCharacterIds(now: number) {
    if (this.client.status !== 'ready') return [];
    try {
      const members = await this.client.zrangebyscore(this.prefix, `(${now}`, '+inf');
      return [...new Set(members.map(member => member.split(':')[0]!))];
    } catch {
      this.logger.warn('Failed to read session presence; arena rooms are hidden');
      return [];
    }
  }
  onApplicationShutdown() { this.client.disconnect(); }
}
