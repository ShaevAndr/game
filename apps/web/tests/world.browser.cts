import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { applyWorldCommand, createCharacter, createVoxelWorld, defaultWorldSettings, initialWorldCatalog, seedContent, worldView, writeWorldBlock,
  type Party, type VoxelWorld, type WorldCommand, type WorldCommandResult, type WorldCargoDocument, type WorldActor } from '@game/core';

// Real Chromium/WebGL and the full application; the API fixture uses the shared pure world rules.
// PostgreSQL, authorization and RabbitMQ have separate test:world/test:cargo integration checks.
test('world screen: rendering, targeting, leader movement, recovery, cargo and mobile fallback', { timeout: 90000 }, async t => {
  const { preview } = await import('vite');
  const vite = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  t.after(() => new Promise<void>((resolve, reject) => { vite.httpServer.closeAllConnections(); vite.httpServer.close(error => error ? reject(error) : resolve()); }));
  const address = vite.httpServer!.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const account = { id: randomUUID(), name: 'Путешественник', createdAt: new Date().toISOString() }, character = { ...createCharacter(randomUUID(), 'Следопыт', seedContent), accountId: account.id };
  const party: Party = { id: randomUUID(), revision: 1, leaderPlayerId: account.id, members: [{ playerId: account.id, characterId: character.id, characterName: character.name,
    membershipId: randomUUID(), joinedAt: Date.now(), level: character.level }] };
  const actor = (): WorldActor => ({ playerId: account.id, characterId: character.id, partyId: party.id, membershipId: party.members[0].membershipId, isLeader: party.leaderPlayerId === account.id });
  const shovel = randomUUID(), axe = randomUUID(), bag = randomUUID();
  let world: VoxelWorld | null = null, cargo: WorldCargoDocument[] = [], lostNext = false, hideReceipts = false, offline = false;
  const receipts = new Map<string, WorldCommandResult>(), actions: WorldCommand[] = [], errors: string[] = [];
  const screenshotDir = process.env.WORLD_UI_SCREENSHOT_DIR;
  await context.addInitScript(() => sessionStorage.setItem('game-session-token', 'browser-fixture'));
  await context.route('**/socket.io/**', route => route.fulfill({ status: 503, body: '' }));
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), body = request.postDataJSON();
    const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === '/accounts') return send([account]);
    if (path === '/identity/session') return send({ account, characterId: character.id, expiresAt: Date.now() + 3600000 });
    if (path === '/characters') return send([character]);
    if (path === '/content') return send(seedContent);
    if (path === '/parties') return send({ party, incoming: [], outgoing: [], players: [], capacity: 6, serverTime: Date.now() });
    if (path === '/social') return send({ revision: 1, visibilityRevision: 1, relationships: [] });
    if (path === '/chat/feed') return send({ messages: [], before: '', after: '', hasMore: false, partyAccess: null });
    if (path === `/characters/${character.id}/inventories`) return send({ ownerId: character.id, inventories: [{ id: bag, ownerId: character.id, primary: true, capacity: 50, name: 'Рюкзак' }],
      definitions: seedContent.items, groups: seedContent.itemGroups, items: [{ id: shovel, itemId: 'digging-shovel', ownerId: character.id, inventoryId: bag, quantity: 1, equippedSlot: null, actions: [] },
        { id: axe, itemId: 'woodcutting-axe', ownerId: character.id, inventoryId: bag, quantity: 1, equippedSlot: null, actions: [] }] });
    if (path === '/world/cargo') return send(cargo);
    if (path.endsWith('/claim')) { cargo = cargo.map(document => ({ ...document, status: 'imported' })); return send({ status: 'imported' }, 201); }
    if (path === '/world/expeditions/current') return send({ worldId: world?.status === 'active' ? world.id : null, state: world?.status === 'active' ? 'active' : null });
    if (path === '/world/expeditions' && body) {
      world = createVoxelWorld({ id: body.worldId, partyId: party.id, seed: 1234, catalog: initialWorldCatalog, settings: defaultWorldSettings, items: seedContent.items,
        gatherers: [{ playerId: account.id, characterId: character.id, xp: 0 }] });
      const result: WorldCommandResult = { worldId: world.id, operationId: body.operationId, revision: 0, outcome: { type: 'start', success: true, loot: [], xpGained: 0, manifestIds: [] } };
      receipts.set(body.operationId, result); return send(result, 201);
    }
    if (path.includes('/operations/')) { const receipt = receipts.get(path.split('/').at(-1)!);
      return send({ state: receipt && !hideReceipts ? 'complete' : 'pending', result: receipt && !hideReceipts ? { status: 201, body: receipt } : null }); }
    if (path.endsWith('/actions') && world) {
      actions.push(body); const previous = receipts.get(body.operationId); if (previous) return send(previous, 201);
      try {
        const transition = applyWorldCommand(world, body, actor(), body.action.type === 'harvest' ? { instanceId: body.action.toolInstanceId, ownerCharacterId: character.id, toolClassId: body.action.toolInstanceId === shovel ? 'shovel' : 'axe' } : undefined, () => true);
        world = transition.state;
        if (body.action.type === 'enter') { const p = world.location!.position!; writeWorldBlock(world.regions.find(region => region.cellId === world!.location!.cellId)!, { ...p, y: p.y - 1 }, 'soil'); }
        if (body.action.type === 'close') cargo = transition.outcome.manifests.map(manifest => ({ ...manifest, hash: 'a'.repeat(64), status: 'available', reason: 'Рюкзак заполнен; освободи место' }));
        const result: WorldCommandResult = { worldId: world.id, operationId: body.operationId, revision: world.revision, outcome: { type: transition.outcome.type, success: transition.outcome.success,
          loot: transition.outcome.loot, xpGained: transition.outcome.xpGained, manifestIds: transition.outcome.manifests.map(manifest => manifest.id) } };
        receipts.set(body.operationId, result);
        if (lostNext) { lostNext = false; hideReceipts = true; return send({ message: 'Результат команды пока неизвестен' }, 503); }
        return send(result, 201);
      } catch (error) { return send({ message: (error as Error).message }, 400); }
    }
    if (path.startsWith('/world/expeditions/') && world) {
      if (offline) return send({ message: 'Сервис мира недоступен' }, 503);
      return send({ ...worldView(world, actor()), partyRevision: party.revision, ownerFence: 1, leaderPlayerId: party.leaderPlayerId,
        members: party.members.map(({ playerId, characterId, membershipId }) => ({ playerId, characterId, membershipId })) });
    }
    return send({ message: `Unhandled test endpoint: ${path}` }, 404);
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  const shot = async (name: string) => { if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, name), fullPage: true }); } };
  try {
    await page.goto(origin + '/#world');
    await page.getByRole('button', { name: 'Начать экспедицию →', exact: true }).click();
    await page.getByRole('button', { name: /отряд здесь/ }).click();
    await page.locator('[data-testid="world-viewport"] canvas').waitFor();
    assert.equal(await page.locator('canvas').evaluate(canvas => !!(canvas as HTMLCanvasElement).getContext('webgl2')), true);
    await page.getByRole('button', { name: 'На север', exact: true }).waitFor();
    const canvas = page.locator('[data-testid="world-viewport"] canvas');
    await shot('world-initial.png');
    const bounds = await canvas.boundingBox(); assert.ok(bounds);
    await canvas.click({ position: { x: bounds.width / 2, y: bounds.height * .6 } });
    await page.locator('.world-target > p').filter({ hasText: /^Блок / }).waitFor();
    await page.getByText(/Блоки рядом/).click();
    await page.locator('.world-nearby button').filter({ hasText: 'Грунт' }).first().click();
    await page.getByLabel('Инструмент для добычи').selectOption(axe);
    assert.equal(await page.getByRole('button', { name: 'Добыть блок', exact: true }).isDisabled(), true);
    await page.getByLabel('Инструмент для добычи').selectOption(shovel);
    await page.getByRole('button', { name: 'Добыть блок', exact: true }).click();
    await page.locator('.world-materials').getByText(/Торф/).waitFor();
    assert.equal(world!.gatherers[0].cargo.find(item => item.itemId === 'peat')?.quantity, 1);
    await shot('world-desktop.png');

    const keyboardDirections = [{ name: 'На север', key: 'ArrowUp' }, { name: 'На запад', key: 'ArrowLeft' }, { name: 'На юг', key: 'ArrowDown' }, { name: 'На восток', key: 'ArrowRight' }];
    let keyboardMove: typeof keyboardDirections[number] | undefined;
    for (const entry of keyboardDirections) if (await page.getByRole('button', { name: entry.name, exact: true }).isEnabled()) { keyboardMove = entry; break; }
    assert.ok(keyboardMove); const beforeKeyboard = world!.revision;
    const movedWithKeyboard = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().postDataJSON()?.expectedRevision === beforeKeyboard);
    await canvas.focus(); await page.keyboard.press(keyboardMove.key); await movedWithKeyboard;
    await page.waitForFunction(() => !document.querySelector('.world-pending'));
    assert.equal(world!.revision, beforeKeyboard + 1); assert.equal(actions.at(-1)!.action.type, 'move');

    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('.world-step')].some(button => !button.disabled));
    const direction = await Promise.all(['На север', 'На запад', 'На юг', 'На восток'].map(async name => ({ name, enabled: await page.getByRole('button', { name, exact: true }).isEnabled() })));
    const move = direction.find(entry => entry.enabled); assert.ok(move, 'fixture must expose a walkable neighbour');
    lostNext = true; await page.getByRole('button', { name: move.name, exact: true }).click();
    await page.getByRole('button', { name: 'Повторить действие' }).waitFor();
    const pending = actions.at(-1)!, revision = world!.revision; assert.equal(pending.action.type, 'move');
    await page.reload(); await page.getByRole('button', { name: 'Повторить действие' }).click();
    await page.waitForFunction(() => !document.querySelector('.world-pending'));
    assert.deepEqual(actions.at(-1), pending); assert.equal(world!.revision, revision); hideReceipts = false;
    await page.getByRole('button', { name: '← Вернуться на карту' }).click();
    await page.getByRole('button', { name: /отряд здесь/ }).click();
    await page.locator('[data-testid="world-viewport"] canvas').waitFor();
    assert.equal(world!.gatherers[0].cargo.find(item => item.itemId === 'peat')?.quantity, 1);

    offline = true; await page.getByRole('button', { name: 'Обновить', exact: true }).first().click();
    await page.getByText('Сервис мира недоступен', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'На север', exact: true }).isDisabled(), true);
    offline = false; await page.getByRole('button', { name: 'Обновить', exact: true }).first().click();
    await page.getByRole('button', { name: 'Завершить экспедицию', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить и забрать груз' }).click();
    await page.getByRole('button', { name: 'Получить', exact: true }).click();
    await page.getByText('Получено ✓', { exact: true }).waitFor();
    assert.equal(cargo[0].status, 'imported');

    // Existing expedition is discovered for a follower without a local world ID.
    world = createVoxelWorld({ id: randomUUID(), partyId: party.id, seed: 1234, catalog: initialWorldCatalog, settings: defaultWorldSettings, items: seedContent.items,
      gatherers: [{ playerId: account.id, characterId: character.id, xp: 1 }] });
    world = applyWorldCommand(world, { operationId: randomUUID(), expectedRevision: 0, action: { type: 'enter' } }, actor()).state;
    party.leaderPlayerId = randomUUID(); party.revision++;
    party.members.push({ playerId: party.leaderPlayerId, characterId: randomUUID(), membershipId: randomUUID(), characterName: 'Лесник', joinedAt: Date.now(), level: 1 });
    await page.reload(); await page.locator('[data-testid="world-viewport"] canvas').waitFor();
    assert.equal(await page.getByRole('button', { name: 'На север', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Завершить экспедицию', exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('world-mobile.png');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(errors.length, 0, errors.join('\n'));

    const fallback = await context.newPage(); await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) { return kind.startsWith('webgl') ? null : Reflect.apply(original, this, [kind, ...args]); } as typeof original;
    });
    await fallback.goto(origin + '/#world'); await fallback.getByText('3D-сцена недоступна', { exact: true }).waitFor();
    await fallback.getByText(/Блоки рядом/).click(); assert.ok(await fallback.locator('.world-nearby button').count() > 0);
    await fallback.close();
  } catch (error) { await shot('world-failure.png'); throw error; }
  finally { await context.close(); }
});
