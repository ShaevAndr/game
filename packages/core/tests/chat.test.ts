import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatSendSchema, mergeChatStreams, type ChatEntry, type ChatMessage } from '../src';

function entry(streamKey: string, sequence: number, id: string, createdAt: string): ChatEntry {
  return { streamKey, sequence, message: { id, createdAt } as ChatMessage };
}
test('merging a feed preserves each stream prefix even when timestamps and IDs are out of order', () => {
  const a = [entry('a', 1, 'z', '2026-01-01'), entry('a', 2, 'a', '2026-01-01')];
  const b = [entry('b', 1, 'b', '2026-01-01')];
  const first = mergeChatStreams([a, b], 2, 'after');
  assert.deepEqual(first.entries.map(item => [item.streamKey, item.sequence]), [['b', 1], ['a', 1]]);
  assert.equal(first.hasMore, true);
  assert.equal(mergeChatStreams([a.slice(1), []], 2, 'after').entries[0].sequence, 2);
});
test('reverse history merging chooses the newest available heads without consuming other streams', () => {
  const result = mergeChatStreams([
    [entry('a', 3, 'a3', '2026-01-03'), entry('a', 2, 'a2', '2026-01-02')],
    [entry('b', 1, 'b1', '2026-01-04')],
  ], 2, 'before');
  assert.deepEqual(result.entries.map(item => item.message.id), ['b1', 'a3']);
  assert.equal(result.hasMore, true);
});
test('chat input permits plain text and rejects forged authorship fields and unsupported destinations', () => {
  const body = { operationId: '00000000-0000-4000-8000-000000000001', authorCharacterId: '00000000-0000-4000-8000-000000000002', destination: { kind: 'world' }, segments: [{ kind: 'text', text: '  привет  ' }] };
  assert.equal(chatSendSchema.parse(body).segments[0].text, 'привет');
  for (const invalid of [{ ...body, senderPlayerId: body.operationId }, { ...body, destination: { kind: 'all' } }, { ...body, segments: [{ kind: 'text', text: ' ' }] }, { ...body, segments: [{ kind: 'text', text: 'x'.repeat(1001) }] }]) {
    assert.equal(chatSendSchema.safeParse(invalid).success, false);
  }
});
