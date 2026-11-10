import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { applyWorldCommand, createCharacter, createVoxelWorld, defaultWorldSettings, initialWorldCatalog, seedContent, worldView, writeWorldBlock,
  type Party, type VoxelWorld, type WorldCommand, type WorldCommandResult, type WorldCargoDocument, type WorldActor, worldBuildingRecipes, worldVoxel } from '@game/core';

// Real Chromium/WebGL and the full application; the API fixture uses the shared pure world rules.
// PostgreSQL, authorization and RabbitMQ have separate test:world/test:cargo integration checks.
test('world screen: rendering, targeting, leader movement, recovery, cargo and mobile fallback', { timeout: 300000 }, async t => {
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
  const shovel = randomUUID(), axe = randomUUID(), pickaxe = randomUUID(), bag = randomUUID();
  let flint = 8, resin = 2; const resources = new Map<string, number>(); let inventoryReads = 0; const movementErrors: string[] = [];
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
    if (path === `/characters/${character.id}/inventories`) { inventoryReads++; return send({ ownerId: character.id, inventories: [{ id: bag, ownerId: character.id, primary: true, capacity: 50, name: 'Рюкзак' }],
      definitions: seedContent.items, groups: seedContent.itemGroups, items: [{ id: shovel, itemId: 'digging-shovel', ownerId: character.id, inventoryId: bag, quantity: 1, equippedSlot: null, actions: [] },
        { id: axe, itemId: 'woodcutting-axe', ownerId: character.id, inventoryId: bag, quantity: 1, equippedSlot: null, actions: [] },
      { id: pickaxe, itemId: 'mining-pick', ownerId: character.id, inventoryId: bag, quantity: 1, equippedSlot: null, actions: [] },
      { id: 'flint', itemId: 'flint', ownerId: character.id, inventoryId: bag, quantity: flint, equippedSlot: null, actions: [] },
      { id: 'resin', itemId: 'tree-resin', ownerId: character.id, inventoryId: bag, quantity: resin, equippedSlot: null, actions: [] },
      ...[...resources].map(([itemId, quantity]) => ({ id: itemId, itemId, quantity, ownerId: character.id, inventoryId: bag, equippedSlot: null, actions: [] }))] }); }
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
        const transition = applyWorldCommand(world, body, actor(), body.action.type === 'harvest' ? { power: 25, usedAt: Date.now(), instanceId: body.action.toolInstanceId, ownerCharacterId: character.id, toolClassId: body.action.toolInstanceId === shovel ? 'shovel' : body.action.toolInstanceId === pickaxe ? 'pickaxe' : 'axe' } : undefined, () => true, body.action.type === 'build' ? { ownerCharacterId: character.id, recipeId: body.action.recipeId, materials: worldBuildingRecipes.find(entry => entry.id === body.action.recipeId)!.ingredients.map(cost => ({ ...cost, instanceId: randomUUID(), reservationId: randomUUID() })) } : undefined, body.action.type === 'move' ? { usedAt: Date.now() } : undefined);
        if (body.action.type === 'build') { flint -= 4; resin--; }
        world = transition.state;
        if (body.action.type === 'enter') { const p = world.location!.position!; writeWorldBlock(world.regions.find(region => region.cellId === world!.location!.cellId)!, { ...worldVoxel(p), y: Math.floor(p.y) - 1 }, 'soil'); }
        for (const manifest of transition.outcome.manifests) {
          cargo.push({ ...manifest, hash: 'a'.repeat(64), status: 'imported' });
          for (const item of manifest.cargo) {
            if (item.itemId === 'flint') flint += item.quantity;
            else if (item.itemId === 'tree-resin') resin += item.quantity;
            else resources.set(item.itemId, (resources.get(item.itemId) ?? 0) + item.quantity);
          }
        }
        const result: WorldCommandResult = { worldId: world.id, operationId: body.operationId, revision: world.revision, outcome: { type: transition.outcome.type, success: transition.outcome.success, ...(transition.outcome.hit ? { hit: transition.outcome.hit } : {}),
          loot: transition.outcome.loot, xpGained: transition.outcome.xpGained, manifestIds: transition.outcome.manifests.map(manifest => manifest.id) },
          ...(body.action.type === 'move' ? { motion: { position: world.location!.position!, velocity: world.location!.motion!.velocity, grounded: world.location!.motion!.grounded, sequence: world.location!.motion!.sequence } } : {}),
          ...(body.action.type === 'collect' ? { inventoryDelivery: { status: 'imported' as const } } : {}) };
        receipts.set(body.operationId, result);
        if (lostNext) { lostNext = false; hideReceipts = true; return send({ message: 'Результат команды пока неизвестен' }, 503); }
        return send(result, 201);
      } catch (error) { if (body.action.type === 'move') movementErrors.push((error as Error).message); return send({ message: (error as Error).message }, 400); }
    }
    if (path.startsWith('/world/expeditions/') && world) {
      if (offline) return send({ message: 'Сервис мира недоступен' }, 503);
      return send({ ...worldView(world, actor()), partyRevision: party.revision, ownerFence: 1, leaderPlayerId: party.leaderPlayerId,
        members: party.members.map(({ playerId, characterId, membershipId }) => ({ playerId, characterId, membershipId })) });
    }
    return send({ message: `Unhandled test endpoint: ${path}` }, 404);
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { worldInputTrace: unknown[] }; state.worldInputTrace = [];
    window.addEventListener('message', event => { if (event.data?.channel === 'game-world' && event.data?.type === 'snapshot') { state.worldInputTrace.push({ type: 'snapshot', locked: event.data.locked, paused: event.data.paused, revision: event.data.revision }); if (state.worldInputTrace.length > 12) state.worldInputTrace.shift(); } });
    window.addEventListener('pointerdown', event => { state.worldInputTrace.push({ type: 'pointerdown', button: event.button, locked: !!document.pointerLockElement }); });
  });
  page.setDefaultTimeout(12000);
  const shot = async (name: string) => { if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, name), fullPage: true }); } };
  const hitSelected = async () => {
    for (let hit = 1; hit <= 4; hit++) {
      await page.waitForTimeout(300);
      const response = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().postDataJSON()?.action.type === 'harvest');
      await page.getByRole('button', { name: 'Бить', exact: true }).click();
      const result = await (await response).json(); assert.equal(result.outcome.hit.hp, 100 - hit * 25);
      if (hit < 4) {
        await page.frameLocator('iframe[title="Мир от первого лица"]').locator('#hp-readout').filter({ hasText: `HP ${100 - hit * 25} / 100` }).waitFor();
        assert.deepEqual(result.outcome.loot, []); assert.equal(result.outcome.xpGained, 0);
      }
    }
  };
  try {
    await page.goto(origin + '/#world');
    await page.getByRole('button', { name: 'Начать экспедицию →', exact: true }).click();
    await page.getByRole('button', { name: /отряд здесь/ }).click();
    await page.frameLocator('iframe[title="Мир от первого лица"]').locator('canvas').waitFor();
    assert.equal(await page.frameLocator('iframe[title="Мир от первого лица"]').locator('canvas').evaluate(canvas => !!(canvas as HTMLCanvasElement).getContext('webgl2')), true);
    await page.getByRole('button', { name: 'На север', exact: true }).waitFor();
    const canvas = page.frameLocator('iframe[title="Мир от первого лица"]').locator('canvas');
    await shot('world-initial.png');
    const bounds = await canvas.boundingBox(); assert.ok(bounds);
    await canvas.click({ position: { x: bounds.width / 2, y: bounds.height * .6 } });
    await page.locator('.world-target > p').filter({ hasText: /^Блок / }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByText(/Блоки рядом/).click();
    await page.locator('.world-nearby button').filter({ hasText: 'Грунт' }).first().click();
    await page.getByRole('button', { name: 'Выбрать инструмент', exact: true }).click();
    const tools = page.getByRole('dialog', { name: 'Выбор инструмента', exact: true });
    assert.equal(await tools.getByRole('button', { name: /Топор/ }).count(), 0);
    await tools.getByRole('button', { name: /лопата/i }).click();
    await hitSelected();
    await page.frameLocator('iframe[title="Мир от первого лица"]').locator('#feedback').filter({ hasText: /В рюкзаке: Торф ×1/ }).waitFor();
    assert.equal(resources.get('peat'), 1); assert.deepEqual(world!.gatherers[0].cargo, []);
    await page.frameLocator('iframe[title="Мир от первого лица"]').locator('#feedback').filter({ hasText: /Торф ×1/ }).waitFor();
    await page.frameLocator('iframe[title="Мир от первого лица"]').locator('#cargo-info').filter({ hasText: /поступают в общий инвентарь сразу/ }).waitFor();
    await shot('world-desktop.png');

    await page.getByRole('button', { name: 'Инвентарь · I', exact: true }).click();
    const inventoryDialog = page.getByRole('dialog', { name: 'Инвентарь', exact: true });
    await inventoryDialog.getByLabel('Ячейки рюкзака', { exact: true }).waitFor();
    assert.equal(await inventoryDialog.getByRole('button', { name: /лопата/i }).count(), 1);
    assert.equal(await inventoryDialog.getByText('Строительство', { exact: true }).count(), 0);
    const pausedRevision = world!.revision;
    await page.keyboard.press('w'); assert.equal(world!.revision, pausedRevision);
    await page.keyboard.press('Escape'); await inventoryDialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Выбрать строение', exact: true }).click();
    const buildings = page.getByRole('dialog', { name: 'Выбор строения', exact: true });
    await buildings.getByRole('heading', { name: 'Каменная кладка' }).waitFor();
    assert.equal(await buildings.getByRole('button', { name: /Топор/ }).count(), 0);
    await page.keyboard.press('Escape'); await buildings.waitFor({ state: 'detached' });

    // Tree and stone rewards appear inside the scene and in the shared backpack before the expedition ends.
    for (const [blockId, blockName, itemId, quantity] of [
      ['stone', 'Каменная порода', 'flint', 1], ['pine-trunk', 'Сосновый ствол', 'pine-wood', 2],
    ] as const) {
      const p = world!.location!.position!, region = world!.regions.find(entry => entry.cellId === world!.location!.cellId)!;
      writeWorldBlock(region, { ...worldVoxel(p), x: Math.floor(p.x) + 2 }, blockId); region.revision++; world!.revision++;
      await page.getByRole('button', { name: 'Обновить', exact: true }).first().click();
      const resourceButton = page.locator('.world-nearby button').filter({ hasText: blockName }).filter({ hasText: `${Math.floor(p.x) + 2}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` });
      await resourceButton.waitFor(); await resourceButton.click();
      if (blockId === 'pine-trunk') {
        assert.ok((await page.getByRole('button', { name: 'Выбрать инструмент', exact: true }).textContent())?.includes('кирка'));
        assert.equal(await page.getByRole('button', { name: 'Бить', exact: true }).isDisabled(), true);
      }
      await page.getByRole('button', { name: 'Выбрать инструмент', exact: true }).click();
      const options = page.getByRole('dialog', { name: 'Выбор инструмента', exact: true });
      await options.getByRole('button', { name: blockId === 'stone' ? /кирка/i : /топор/i }).click();
      await hitSelected();
      const itemName = seedContent.items.find(item => item.id === itemId)!.name;
      await page.frameLocator('iframe[title="Мир от первого лица"]').locator('#feedback').filter({ hasText: `В рюкзаке: ${itemName} ×${quantity}` }).waitFor();
      assert.equal(itemId === 'flint' ? flint : resources.get(itemId), itemId === 'flint' ? 8 + quantity : quantity);
      assert.deepEqual(world!.gatherers[0].cargo, []);
    }

    // Exercise real pointer input: both actions stay assigned while the blueprint is selected.
    const player = worldVoxel(world!.location!.position!), region = world!.regions.find(entry => entry.cellId === world!.location!.cellId)!;
    for (let x = 0; x < region.size.x; x++) for (let z = 0; z < region.size.z; z++) {
      for (let y = player.y; y < region.size.y; y++) writeWorldBlock(region, { x, y, z }, null);
      writeWorldBlock(region, { x, y: player.y - 1, z }, 'soil');
    }
    region.revision++; world!.revision++;
    await page.reload(); await canvas.waitFor();
    await canvas.click();
    const movementFrame = page.frames().find(frame => frame.url().endsWith('/world.html'))!;
    await movementFrame.waitForFunction(() => !!document.pointerLockElement);
    const startPosition = { ...world!.location!.position! }, inventoryBeforeWalk = inventoryReads;
    await page.keyboard.down('w'); await page.keyboard.down('d'); await page.waitForTimeout(350);
    await page.keyboard.up('w'); await page.keyboard.up('d');
    await page.waitForTimeout(500);
    const walked = { ...world!.location!.position! };
    assert.ok(walked.x > startPosition.x + .4 && walked.z > startPosition.z + .4, 'W+D moves diagonally in the continuous world');
    assert.ok(Math.abs(walked.x % 1 - .5) > .01, 'server position is not pinned to voxel centres');
    const jumpStart = { ...walked };
    await page.keyboard.down('Space'); await page.keyboard.down('a'); await page.waitForTimeout(160);
    await page.keyboard.up('Space'); await page.keyboard.up('a');
    const airborne = await movementFrame.locator('#position-info').evaluate(el => ({ y: Number((el as HTMLElement).dataset.y), grounded: (el as HTMLElement).dataset.grounded }));
    assert.equal(airborne.grounded, 'false'); assert.ok(airborne.y > jumpStart.y * .5 + .1);
    await page.keyboard.down('s'); await page.waitForTimeout(160); await page.keyboard.up('s');
    await page.waitForTimeout(1100);
    const landed = { ...world!.location!.position! };
    assert.ok(landed.x < jumpStart.x - .2 && landed.z < jumpStart.z - .2, 'direction can change during the jump');
    assert.equal(world!.location!.motion!.grounded, true);
    assert.ok(inventoryReads - inventoryBeforeWalk <= 2, 'movement acknowledgements do not reload the backpack per packet');
    assert.deepEqual(movementErrors, []);
    await page.keyboard.press('Escape'); await page.reload(); await canvas.waitFor();
    assert.deepEqual(world!.location!.position, landed, 'fractional position survives reload');
    // Reset the fixture position for independent pointer mining/building checks.
    world!.location!.position = startPosition; world!.location!.motion = { velocity: { x: 0, y: 0, z: 0 }, grounded: true, sequence: 0 }; world!.revision++;
    await page.reload(); await canvas.waitFor();
    await canvas.click();
    const frame = page.frames().find(frame => frame.url().endsWith('/world.html'))!;
    await frame.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('i'); await inventoryDialog.waitFor();
    await frame.waitForFunction(() => !document.pointerLockElement);
    await page.keyboard.press('Escape'); await inventoryDialog.waitFor({ state: 'detached' });
    // Browser blocks immediate pointer recapture after Escape.
    await page.waitForTimeout(1200); await canvas.click();
    await frame.waitForFunction(() => !!document.pointerLockElement);
    await canvas.evaluate(async canvas => { for (let i = 0; i < 9; i++) { canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, movementY: 100, bubbles: true })); await new Promise(resolve => setTimeout(resolve, 35)); } });
    await page.waitForTimeout(150);
    const floorLabel = `Блок ${player.x}, ${player.y - 1}, ${player.z + 2}`;
    for (let i = 0; i < 10 && !(await page.locator('.world-target > p').filter({ hasText: /^Блок / }).first().textContent())?.includes(floorLabel); i++) {
      await canvas.evaluate(canvas => canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, movementY: 70, bubbles: true })));
      await page.waitForTimeout(100);
    }
    assert.ok((await page.locator('.world-target > p').filter({ hasText: /^Блок / }).first().textContent())?.includes(floorLabel));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Выбрать инструмент', exact: true }).click();
    await page.getByRole('dialog', { name: 'Выбор инструмента', exact: true }).getByRole('button', { name: /кирка/i }).click();
    await page.waitForTimeout(1200); await canvas.click(); await frame.waitForFunction(() => !!document.pointerLockElement);
    const beforeBuild = world!.revision, beforeFlint = flint, beforeResin = resin;
    const placed = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().postDataJSON()?.action.type === 'build');
    await page.mouse.click(0, 0, { button: 'right' }); await placed;
    await page.waitForFunction(() => !document.querySelector('.world-pending'));
    assert.equal(world!.revision, beforeBuild + 1); assert.equal(flint, beforeFlint - 4); assert.equal(resin, beforeResin - 1);
    await page.waitForTimeout(250);
    await page.mouse.down(); await page.waitForTimeout(2200); await page.mouse.up();
    assert.ok(actions.some(action => action.expectedRevision > beforeBuild && action.action.type === 'harvest')); // LMB still hits while a building is assigned.
    await page.frameLocator('iframe[title="Мир от первого лица"]').locator('#feedback').filter({ hasText: /В рюкзаке: Кремень ×2/ }).waitFor();
    await page.keyboard.press('Escape');

    const keyboardDirections = [{ name: 'На север', key: 'ArrowUp' }, { name: 'На запад', key: 'ArrowLeft' }, { name: 'На юг', key: 'ArrowDown' }, { name: 'На восток', key: 'ArrowRight' }];
    let keyboardMove: typeof keyboardDirections[number] | undefined;
    for (const entry of keyboardDirections) if (await page.getByRole('button', { name: entry.name, exact: true }).isEnabled()) { keyboardMove = entry; break; }
    assert.ok(keyboardMove); const beforeKeyboard = world!.revision;
    const movedWithKeyboard = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().postDataJSON()?.expectedRevision === beforeKeyboard);
    await page.locator('.world-heading h2').click(); await page.keyboard.press(keyboardMove.key); await movedWithKeyboard;
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
    await page.frameLocator('iframe[title="Мир от первого лица"]').locator('canvas').waitFor();
    assert.equal(resources.get('peat'), 1); assert.deepEqual(world!.gatherers[0].cargo, []);

    offline = true; await page.getByRole('button', { name: 'Обновить', exact: true }).first().click();
    await page.getByText('Сервис мира недоступен', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'На север', exact: true }).isDisabled(), true);
    offline = false; await page.getByRole('button', { name: 'Обновить', exact: true }).first().click();
    await page.getByRole('button', { name: 'Завершить экспедицию', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить и забрать груз' }).click();
    await page.getByRole('button', { name: 'Начать экспедицию →', exact: true }).waitFor();
    await page.getByText('Получено ✓', { exact: true }).first().waitFor();
    assert.ok(cargo.length > 0 && cargo.every(document => document.status === 'imported'));
    assert.equal(resources.get('pine-wood'), 2); assert.equal(resources.get('peat'), 1);

    // Existing expedition is discovered for a follower without a local world ID.
    world = createVoxelWorld({ id: randomUUID(), partyId: party.id, seed: 1234, catalog: initialWorldCatalog, settings: defaultWorldSettings, items: seedContent.items,
      gatherers: [{ playerId: account.id, characterId: character.id, xp: 1 }] });
    world = applyWorldCommand(world, { operationId: randomUUID(), expectedRevision: 0, action: { type: 'enter' } }, actor()).state;
    party.leaderPlayerId = randomUUID(); party.revision++;
    party.members.push({ playerId: party.leaderPlayerId, characterId: randomUUID(), membershipId: randomUUID(), characterName: 'Лесник', joinedAt: Date.now(), level: 1 });
    await page.reload(); await page.frameLocator('iframe[title="Мир от первого лица"]').locator('canvas').waitFor();
    assert.equal(await page.getByRole('button', { name: 'На север', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Завершить экспедицию', exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('world-mobile.png');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(errors.length, 0, errors.join('\n'));

    const fallback = await context.newPage(); await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) { return /^(webgl|experimental-webgl)/.test(kind) ? null : Reflect.apply(original, this, [kind, ...args]); } as typeof original;
    });
    await fallback.goto(origin + '/#world'); await fallback.getByText('3D-сцена недоступна', { exact: true }).waitFor();
    await fallback.getByText(/Блоки рядом/).click(); assert.ok(await fallback.locator('.world-nearby button').count() > 0);
    await fallback.close();
  } catch (error) { await shot('world-failure.png'); for (const frame of page.frames()) if (frame.url().includes('world.html')) console.error(await frame.evaluate(() => (window as unknown as { worldInputTrace: unknown[] }).worldInputTrace)); throw error; }
  finally { await context.close(); }
});
