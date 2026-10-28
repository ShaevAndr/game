import { Injectable, Logger, BeforeApplicationShutdown } from '@nestjs/common';
import { ConnectionOptions, Queue, Worker } from 'bullmq';
import { TaskQueue } from '../../shared/application/task-queue.port';

function connection(worker: boolean): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://');
  return {
    host: url.hostname, port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0), tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: worker ? null : 1, enableOfflineQueue: worker, connectTimeout: 2000,
    commandTimeout: worker ? undefined : 5000,
    // Producers fail promptly and are recreated on the next outbox attempt.
    // BullMQ's initial waitUntilReady otherwise waits forever while Redis is offline.
    ...(worker ? {} : { retryStrategy: () => null }),
  };
}

@Injectable()
export class BullMqTaskQueue extends TaskQueue implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BullMqTaskQueue.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  async enqueue<T extends object>(name: string, id: string, data: T) {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: connection(false), prefix: `${process.env.REDIS_NAMESPACE ?? 'game'}:jobs` });
      queue.on('error', () => this.logger.warn(`Queue ${name}: Redis unavailable`));
      this.queues.set(name, queue);
    }
    try {
      await queue.add(name, data, {
        jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 }, removeOnFail: false,
      });
    } catch (error) {
      if (this.queues.get(name) === queue) this.queues.delete(name);
      await queue.close().catch(() => undefined);
      throw error;
    }
  }

  consume<T extends object>(name: string, handler: (data: T) => Promise<void>) {
    if (this.workers.has(name)) throw new Error(`Worker already registered: ${name}`);
    const worker = new Worker<T>(name, job => handler(job.data), {
      connection: connection(true), prefix: `${process.env.REDIS_NAMESPACE ?? 'game'}:jobs`, concurrency: 2,
    });
    worker.on('error', () => this.logger.warn(`Worker ${name}: Redis unavailable`));
    worker.on('failed', (job, error) => this.logger.error(`Job ${name}/${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`));
    this.workers.set(name, worker);
  }

  async beforeApplicationShutdown() {
    await Promise.all([...this.workers.values()].map(worker => worker.close()));
    await Promise.all([...this.queues.values()].map(queue => queue.close()));
  }
}
