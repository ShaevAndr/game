import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InProcessStateChanges } from '../src/infrastructure/updates/in-process-state-changes';

test('notifications wait for commit and listener failure cannot fail a committed mutation', () => {
  const changes = new InProcessStateChanges(), effects: (() => void)[] = [], received: unknown[] = [];
  changes.subscribe(() => { throw new Error('disconnected transport'); });
  const unsubscribe = changes.subscribe(change => received.push(change));
  const change = { topics: ['parties' as const], accountIds: ['owner'] };
  changes.publish(change, { id: Symbol(), afterCommit: effect => effects.push(effect) });
  assert.deepEqual(received, []);
  effects[0]();
  assert.deepEqual(received, [change]);
  unsubscribe(); changes.publish(change);
  assert.equal(received.length, 1);
});
