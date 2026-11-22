import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RabbitRpc } from '../src';
import amqp from 'amqplib';

test('an unconfigured broker fails closed without accepting a fictitious result', async () => {
  const rpc = new RabbitRpc({ producer: 'server', namespace: () => 'test', url: () => undefined, secret: () => undefined });
  assert.equal(rpc.enabled(), false);
  await assert.rejects(rpc.request('world', 'world.deliver', 'request', {}), /not configured/);
  await rpc.close();
});
test('handler registration rejects ambiguity and can be cleanly removed during shutdown', async () => {
  const rpc = new RabbitRpc({ producer: 'world', namespace: () => 'test', url: () => undefined, secret: () => undefined });
  const remove = rpc.handle('world.deliver', 'server', async () => 'done');
  assert.throws(() => rpc.handle('world.deliver', 'server', async () => 'other'), /Duplicate/);
  remove(); rpc.handle('world.deliver', 'server', async () => 'other'); await rpc.close();
});


test('broker failures share one connection attempt and pause retries from concurrent callers', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const connect = t.mock.method(amqp, 'connect', async () => { throw new Error('DNS unavailable'); });
  const rpc = new RabbitRpc({ producer: 'server', namespace: () => 'test',
    url: () => 'amqp://unavailable:5672', secret: () => 'a'.repeat(32) });
  try {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, id) => rpc.request('world', 'test', String(id), {})));
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.equal(connect.mock.callCount(), 1);
    now += 29_999;
    await assert.rejects(rpc.request('world', 'test', 'paused', {}), /reconnect delayed/);
    assert.equal(connect.mock.callCount(), 1);
    now += 1;
    await assert.rejects(rpc.request('world', 'test', 'retry', {}), /unavailable/);
    assert.equal(connect.mock.callCount(), 2);
  } finally { await rpc.close(); }
});
