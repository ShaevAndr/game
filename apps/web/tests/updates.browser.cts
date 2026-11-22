import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createCharacter, seedContent, type StateTopic } from '@game/core';

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(20); }
  assert.fail('Expected browser update did not arrive');
}

test('push replaces idle polling, coalesces invalidations, restores after reconnect and releases page subscriptions', { timeout: 60_000 }, async t => {
  const { preview } = await import('vite');
  const vite = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  // The fixture uses the workspace's server transport, with no player databases.
  const { Server } = createRequire(join(process.cwd(), '../server/package.json'))('socket.io');
  const server = new Server(vite.httpServer), updates = server.of('/updates');
  let subscribed: StateTopic[] = [], subscriptions = 0, allowSubscriptions = true;
  updates.on('connection', (socket: any) => {
    socket.on('subscribe', (topics: StateTopic[], ack: (value: unknown) => void) => {
      subscribed = topics; subscriptions++; ack(allowSubscriptions ? { ok: true } : { error: 'offline' });
    });
    socket.on('heartbeat', (ack: (value: unknown) => void) => ack({ ok: true }));
  });
  server.of('/chat').on('connection', (socket: any) => socket.on('subscribe', (ack: (value: unknown) => void) => ack({ ok: true })));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = vite.httpServer!.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => sessionStorage.setItem('game-session-token', 'a'.repeat(64)));
  const account = { id: randomUUID(), name: 'Push tester', createdAt: new Date().toISOString() };
  const hero = createCharacter(randomUUID(), 'Герой', seedContent); hero.accountId = account.id;
  let selected: string | null = hero.id;
  const counts = new Map<string, number>(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let rooms: unknown[] = [], delayRooms = false, held: (() => Promise<void>) | undefined;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const send = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/identity/session/character') { selected = route.request().postDataJSON().characterId; return send({ account, characterId: selected, expiresAt: Date.now() + 3600_000 }); }
    if (path === '/identity/session') return send({ account, characterId: selected, expiresAt: Date.now() + 3600_000 });
    if (path === '/accounts') return send([account]);
    if (path === '/characters') return send([hero]);
    if (path === '/content') return send(seedContent);
    if (path === '/parties') return send({ party: null, incoming: [], outgoing: [], players: [], capacity: 6, serverTime: Date.now() });
    if (path === '/social') return send({ revision: 0, visibilityRevision: 0, relationships: [] });
    if (path === '/chat/feed') return send({ messages: [], after: 'after', before: 'before', hasMore: false, partyAccess: null });
    if (path.startsWith('/battles/arena/')) return send({ incoming: [], outgoing: [], activeBattleId: null });
    if (path === '/battles') {
      const response = [...rooms];
      if (delayRooms) { delayRooms = false; held = () => send(response); return; }
      return send(response);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.clock.install();
  await page.goto(`${origin}/`); await page.getByRole('heading', { name: 'Арена', exact: true }).waitFor();
  await until(() => subscribed.includes('rooms') && subscribed.includes('parties') && subscribed.includes('social'));
  await delay(500);
  const idle = new Map(counts);
  await delay(6500);
  assert.deepEqual(counts, idle, 'healthy sockets must not poll REST every 2–5 seconds');
  const previous = counts.get('/battles')!;
  delayRooms = true; updates.emit('state.changed', { topics: ['rooms'] }); await until(() => !!held);
  updates.emit('state.changed', { topics: ['rooms'] }); updates.emit('state.changed', { topics: ['rooms'] });
  await delay(50); assert.equal(counts.get('/battles'), previous + 1, 'invalidation must not overlap an in-flight read');
  await held!(); await until(() => counts.get('/battles') === previous + 2);
  const oldSubscriptions = subscriptions;
  updates.disconnectSockets(true); await until(() => [...updates.sockets.values()].length === 0);
  // The account heartbeat retries a server-disconnected namespace, not just a broken transport.
  await delay(100); await page.clock.fastForward(20_000);
  await until(() => subscriptions > oldSubscriptions);
  await delay(200);
  await page.getByRole('button', { name: 'Навыки', exact: true }).click(); await page.locator('.skill-branches').waitFor();
  await until(() => !subscribed.includes('rooms'));
  const left = counts.get('/battles'); updates.emit('state.changed', { topics: ['rooms'] }); await delay(100);
  assert.equal(counts.get('/battles'), left, 'a closed page must release its subscription');
  await page.getByRole('button', { name: 'Арена', exact: true }).click(); await until(() => subscribed.includes('rooms'));
  await delay(100);
  // Hidden documents defer push-triggered reads and refresh when they become visible.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = counts.get('/battles'); updates.emit('state.changed', { topics: ['rooms'] }); await delay(100);
  assert.equal(counts.get('/battles'), hidden);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await until(() => counts.get('/battles')! > hidden!);
  await page.getByRole('button', { name: 'Открыть чат', exact: true }).click();
  await page.getByRole('textbox', { name: 'Текст сообщения' }).fill('Черновик при смене героя');
  await page.getByRole('button', { name: 'Персонажи', exact: true }).click();
  await page.getByRole('button', { name: /Герой/ }).click();
  await page.locator('.rooms').waitFor();
  await until(() => subscribed.includes('rooms'));
  assert.equal(await page.getByRole('textbox', { name: 'Текст сообщения' }).inputValue(), 'Черновик при смене героя');
  allowSubscriptions = false; updates.disconnectSockets(true); await delay(100);
  const offline = counts.get('/battles')!;
  await page.clock.fastForward(30_000); await until(() => counts.get('/battles')! > offline);
  assert.deepEqual(errors, []);
});
