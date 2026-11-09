import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RabbitRpc } from '../src';

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
