import { Module } from '@nestjs/common';
import { TaskQueue } from '../../shared/application/task-queue.port';
import { BullMqTaskQueue } from './bullmq-task-queue';

@Module({ providers: [{ provide: TaskQueue, useClass: BullMqTaskQueue }], exports: [TaskQueue] })
export class QueuesModule {}
