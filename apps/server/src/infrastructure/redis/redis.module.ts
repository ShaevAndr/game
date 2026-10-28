import { Module } from '@nestjs/common';
import { Cache } from '../../shared/application/cache.port';
import { RedisCache } from './redis-cache';

@Module({ providers: [{ provide: Cache, useClass: RedisCache }], exports: [Cache] })
export class RedisModule {}
