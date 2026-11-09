import { connect } from 'amqplib';
export { connect as connectRabbit } from 'amqplib';
/** Only explicitly generated test namespaces can be removed. Never purges shared application queues. */
export async function removeTestQueues(url: string, namespace: string) {
  if (!/^test-[a-zA-Z0-9-]{8,90}$/.test(namespace)) throw new Error('Refusing to remove a non-test namespace');
  const connection = await connect(url, { timeout: 2000 });
  try {
    for (const peer of ['server', 'world']) for (const suffix of ['.retry', '.failed', '']) {
      const channel = await connection.createChannel(); channel.on('error', () => {});
      try { await channel.deleteQueue(`${namespace}.${peer}.requests${suffix}`); } catch { /* Already removed. */ }
      finally { await channel.close().catch(() => {}); }
    }
  } finally { await connection.close(); }
}
