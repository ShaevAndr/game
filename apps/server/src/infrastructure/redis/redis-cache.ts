import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Cache } from '../../shared/application/cache.port';

@Injectable()
export class RedisCache extends Cache implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisCache.name);
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
    connectTimeout: 2000, commandTimeout: 2000,
  });

  constructor() {
    super();
    this.client.on('error', () => this.logger.warn('Redis cache unavailable; reading from source'));
  }

  async onModuleInit() {
    try { await this.client.connect(); } catch { /* Cache is optional; Redis will reconnect. */ }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.client.status !== 'ready') return null;
    try {
      const value = await this.client.get(`${process.env.REDIS_NAMESPACE ?? 'game'}:cache:${key}`);
      return value === null ? null : JSON.parse(value) as T;
    } catch { return null; }
  }

  async set<T>(key: string, value: T, ttlSeconds: number) {
    if (this.client.status !== 'ready') return;
    try { await this.client.set(`${process.env.REDIS_NAMESPACE ?? 'game'}:cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds); }
    catch { /* A cache write must not fail a committed user operation. */ }
  }

  async delete(key: string) {
    if (this.client.status !== 'ready') return;
    try { await this.client.del(`${process.env.REDIS_NAMESPACE ?? 'game'}:cache:${key}`); } catch { /* Expiration still bounds staleness. */ }
  }

  onApplicationShutdown() { this.client.disconnect(); }
}
