import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RabbitRpc, MessageFailure } from '../src';
import { connectRabbit, removeTestQueues } from '../src/testing';

test('RabbitMQ confirms, application replies, delayed retries, quarantine and reconnection', { timeout: 30000 }, async t => {
  const url = process.env.TEST_RABBITMQ_URL ?? 'amqp://game:game@127.0.0.1:5672';
  const namespace = `test-rpc-${randomUUID()}`, secret = randomUUID();
  const options = { url: () => url, secret: () => secret, namespace: () => namespace, retryDelayMs: 80, maxAttempts: 3, timeoutMs: 2500 };
  let worldOnline = true;
  const server = new RabbitRpc({ ...options, producer: 'server' }), world = new RabbitRpc({ ...options, producer: 'world', url: () => worldOnline ? url : undefined });
  const observer = await connectRabbit(url), channel = await observer.createChannel();
  const failed = () => channel.checkQueue(`${namespace}.world.requests.failed`);
  server.start(); world.start();
  try {
    await t.test('publisher acceptance does not complete the request before the handler commits', async () => {
      let release!: () => void, entered!: () => void, settled = false;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      world.handle('commit', 'server', async value => { entered(); await gate; return value; });
      const result = server.request('world', 'commit', 'commit-1', { committed: true }).finally(() => { settled = true; });
      await started; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(settled, false);
      release(); assert.deepEqual(await result, { committed: true });
    });
    await t.test('transient failures use delayed delivery and permanent failures enter a durable failure queue', async () => {
      const times: number[] = [];
      world.handle('transient', 'server', async () => { times.push(Date.now()); if (times.length < 3) throw new Error('database unavailable'); return 'committed'; });
      assert.equal(await server.request('world', 'transient', 'retry-1', {}), 'committed');
      assert.equal(times.length, 3); assert.ok(times[2] - times[0] >= 120);
      world.handle('permanent', 'server', async () => { throw new MessageFailure('immutable document changed', false, 'CONFLICT'); });
      await assert.rejects(server.request('world', 'permanent', 'invalid-1', {}), error => error instanceof MessageFailure && !error.retryable && error.code === 'CONFLICT');
      assert.equal((await failed()).messageCount, 1);
      let attempts = 0;
      world.handle('exhausted', 'server', async () => { attempts++; throw new Error('still offline'); });
      await assert.rejects(server.request('world', 'exhausted', 'retry-2', {}), MessageFailure);
      assert.equal(attempts, 3); assert.equal((await failed()).messageCount, 2);
    });
    await t.test('producer and signatures are checked before dispatch', async () => {
      let invoked = 0;
      world.handle('world-only', 'world', async () => { invoked++; return true; });
      await assert.rejects(server.request('world', 'world-only', 'wrong-producer', {}), error => error instanceof MessageFailure && error.code === 'MESSAGE_PRODUCER');
      assert.equal(invoked, 0);
      const untrusted = new RabbitRpc({ ...options, secret: () => randomUUID(), producer: 'server', timeoutMs: 300 });
      try { await assert.rejects(untrusted.request('world', 'world-only', 'wrong-signature', {}), MessageFailure); }
      finally { await untrusted.close(); }
      assert.equal(invoked, 0); assert.equal((await failed()).messageCount, 4);
    });
    await t.test('a lost reply is unknown; a fresh caller can recover the application receipt', async () => {
      const receipts = new Map<string, unknown>(); let commits = 0;
      world.handle('receipt', 'server', async (payload, context) => {
        if (!receipts.has(context.id)) { commits++; receipts.set(context.id, payload); }
        await new Promise(resolve => setTimeout(resolve, 100)); return receipts.get(context.id);
      });
      const short = new RabbitRpc({ ...options, producer: 'server', timeoutMs: 20 });
      try { await assert.rejects(short.request('world', 'receipt', 'stable-id', { granted: 3 }), MessageFailure); }
      finally { await short.close(); }
      assert.deepEqual(await server.request('world', 'receipt', 'stable-id', { granted: 3 }), { granted: 3 });
      assert.equal(commits, 1);
    });
    await t.test('deleted test queues are recreated and the caller reconnects', async () => {
      worldOnline = false;
      await channel.deleteQueue(`${namespace}.world.requests`);
      await new Promise(resolve => setTimeout(resolve, 100));
      // A missing route is an infrastructure failure; it must not quarantine application outbox data.
      await assert.rejects(server.request('world', 'commit', 'missing-route', {}), error => error instanceof MessageFailure && error.retryable && error.code === 'MESSAGE_UNROUTABLE');
      worldOnline = true;
      server.handle('probe', 'world', async () => true);
      await world.request('server', 'probe', 'world-online', {});
      assert.deepEqual(await server.request('world', 'commit', 'world-recovered', { recovered: true }), { recovered: true });
      await channel.deleteQueue(`${namespace}.server.requests`);
      // Consumer cancellation closes its session; the next request opens and declares it again.
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual(await server.request('world', 'commit', 'after-reconnect', { recovered: true }), { recovered: true });
      await channel.checkQueue(`${namespace}.server.requests`);
    });
  } finally {
    await server.close(); await world.close(); await channel.close(); await observer.close(); await removeTestQueues(url, namespace);
  }
});
