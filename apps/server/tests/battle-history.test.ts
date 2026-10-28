import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createCharacter, newBattle, seedContent } from '@game/core';
import { BattleHistoryService } from '../src/modules/battle-history/application/battle-history.service';
import { BattleArchiveOutbox, BattleHistoryRepository } from '../src/modules/battle-history/ports/battle-history.repository';
import { TaskQueue } from '../src/shared/application/task-queue.port';

const character = createCharacter('00000000-0000-4000-8000-000000000001', 'Герой', seedContent);
const completed = newBattle('00000000-0000-4000-8000-000000000002', 'Бой', 'bot', 'before', character, seedContent);
completed.status = 'finished';

test('Redis failure leaves the committed archive event pending and it is delivered on recovery', async () => {
  const pending = [completed];
  let unavailable = true;
  const jobs: { id: string; data: object }[] = [];
  const outbox = {
    pending: async () => [...pending],
    delivered: async (id: string) => { pending.splice(pending.findIndex(battle => battle.id === id), 1); },
  } as unknown as BattleArchiveOutbox;
  const queue = {
    enqueue: async (_name: string, id: string, data: object) => {
      if (unavailable) throw new Error('Redis unavailable');
      jobs.push({ id, data });
    },
  } as unknown as TaskQueue;
  const service = new BattleHistoryService(outbox, {} as BattleHistoryRepository, queue);
  await service.dispatch();
  assert.equal(pending.length, 1);
  assert.equal(jobs.length, 0);
  unavailable = false;
  await service.dispatch();
  assert.equal(pending.length, 0);
  assert.deepEqual(jobs, [{ id: completed.id, data: { battle: completed } }]);
});

test('a crash after enqueue can redeliver the same id without discarding the event', async () => {
  let pending: Battle[] = [completed];
  let interrupted = true;
  const ids: string[] = [];
  const outbox = {
    pending: async () => pending,
    delivered: async () => { if (interrupted) throw new Error('database unavailable'); pending = []; },
  } as unknown as BattleArchiveOutbox;
  const queue = { enqueue: async (_name: string, id: string) => { ids.push(id); } } as unknown as TaskQueue;
  const service = new BattleHistoryService(outbox, {} as BattleHistoryRepository, queue);
  await service.dispatch();
  assert.equal(pending.length, 1);
  interrupted = false;
  await service.dispatch();
  assert.deepEqual(ids, [completed.id, completed.id]);
  assert.equal(pending.length, 0);
});
