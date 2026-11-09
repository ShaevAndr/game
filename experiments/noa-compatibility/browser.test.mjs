import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ mode: 'test', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' }); await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
let browser;
const results = { engine: 'noa-engine 0.33.0', checks: [], renderer: 'Chrome / SwiftShader; isolated in-memory API' };
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); results.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let lastDrop;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/probe-api')) { const body = request.postDataJSON(); if (body.type === 'drop') lastDrop = body; } });
  async function ready() { await page.goto(origin); await page.waitForFunction(() => window.probe?.stats().frames > 5 && window.probe.noa.world.playerChunkLoaded); }
  async function reset() { await page.request.post(origin + '/probe-api', { data: { type: 'reset' } }); await ready(); }
  async function command(value) { return page.evaluate(value => window.probe.command(value), value); }
  async function idle() { await page.waitForFunction(() => document.querySelector('#retry').hidden && sessionStorage.getItem('noa-pending-operation') === null); }
  const target = { x: 6, y: 4, z: 8 };
  const hp = () => page.evaluate(p => window.probe.snapshot().view.region.blocks.find(block => ['x', 'y', 'z'].every(axis => block.position[axis] === p[axis]))?.hp, target);
  const count = (id, actor = 'weak') => page.evaluate(({ id, actor }) => window.probe.snapshot().inventory[actor].filter(item => item.itemId === id).reduce((sum, item) => sum + item.quantity, 0), { id, actor });
  const card = id => page.locator(`#inventory-items [data-item="${id}"]`).first();
  await ready(); assert.equal(await page.evaluate(() => window.probe.noa.version), '0.33.0');
  assert.deepEqual(await page.evaluate(() => [...window.probe.noa.targetedBlock.position]), [6, 4, 8]);
  assert.equal(await page.evaluate(() => window.probe.noa.getBlock(0, 0, 0)), 1);
  assert.ok(await page.evaluate(() => window.probe.noa.rendering.getScene().meshes.some(mesh => mesh.getTotalVertices() > 0)));
  results.checks.push('WebGL, irregular public geometry, stable block IDs and unknown solidity');

  const canvas = page.locator('#game canvas'); await canvas.click();
  await page.waitForFunction(() => window.probe.noa.container.hasPointerLock);
  await page.mouse.move(1020, 550, { steps: 5 });
  await page.waitForFunction(() => Math.abs(window.probe.noa.camera.heading) > .05 && Math.abs(window.probe.noa.camera.pitch) > .02);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.probe.noa.container.hasPointerLock);
  const angles = await page.evaluate(() => [window.probe.noa.camera.heading, window.probe.noa.camera.pitch]);
  await page.mouse.move(720, 500); await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => [window.probe.noa.camera.heading, window.probe.noa.camera.pitch]), angles);
  await page.waitForTimeout(1100); await canvas.click(); await page.waitForFunction(() => window.probe.noa.container.hasPointerLock);
  results.checks.push('Mouse capture, yaw/pitch rotation, Escape and recapture');
  await reset(); await page.mouse.move(720, 500);
  await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w');
  const p = await page.evaluate(() => [...window.probe.noa.entities.getPosition(window.probe.noa.playerEntity)]); assert.ok(p[2] > 6 && p[2] < 8);
  await page.keyboard.down('Space'); await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => window.probe.noa.entities.getPosition(window.probe.noa.playerEntity)[1] > 3.2)); await page.keyboard.up('Space');
  results.checks.push('WASD, collision and jump');

  for (const [actor, hits] of [['weak', 10], ['strong', 4]]) {
    await reset();
    for (let i = 0; i < hits; i++) {
      const value = { type: 'hit', actor, operationId: `${actor}-${i}`, position: target, damage: 99999 };
      await command(value);
      if (!i) { const before = await hp(); await command(value); assert.equal(await hp(), before); assert.notEqual(await page.evaluate(() => window.probe.noa.getBlock(6, 4, 8)), 0); }
      if (i < hits - 1) await page.waitForTimeout(280);
    }
    assert.equal(await hp(), undefined); assert.equal(await page.evaluate(() => window.probe.noa.getBlock(6, 4, 8)), 0);
    assert.ok(await page.evaluate(() => window.probe.stats().dropMeshes >= 1));
  }
  results.checks.push('Strength-based HP, retry without extra damage and material drops only at destruction');
  await page.getByLabel('Персонаж').selectOption('strong');
  await page.evaluate(() => window.probe.noa.entities.setPosition(window.probe.noa.playerEntity, [6.5, 3, 7.1]));
  await page.mouse.move(720, 500); await page.keyboard.press('e'); await idle();
  assert.ok(await count('stone-piece', 'strong') > 80);
  results.checks.push('Rendered material drops can be picked up into stacks with E');

  await reset(); await canvas.click(); await page.keyboard.press('i');
  await page.getByRole('dialog', { name: /Рюкзак/ }).waitFor(); await page.waitForFunction(() => !window.probe.noa.container.hasPointerLock);
  const stationary = await page.evaluate(() => [...window.probe.noa.entities.getPosition(window.probe.noa.playerEntity)]);
  await page.keyboard.press('w'); await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => [...window.probe.noa.entities.getPosition(window.probe.noa.playerEntity)]), stationary);
  await card('iron-sword').getByRole('button', { name: 'Взять в руку', exact: true }).click(); await idle();
  assert.equal(await card('iron-sword').getByRole('button', { name: 'В руке ✓', exact: true }).getAttribute('aria-pressed'), 'true');
  const stones = card('stone-piece'); await stones.getByRole('spinbutton').fill('7'); await stones.getByRole('button', { name: 'Выбросить', exact: true }).click(); await idle();
  assert.equal(await count('stone-piece'), 73); assert.equal(lastDrop.quantity, 7);
  await command(lastDrop); assert.equal(await count('stone-piece'), 73);
  const beforeInvalid = await page.evaluate(() => window.probe.snapshot().view.revision);
  await card('stone-piece').getByRole('spinbutton').fill('1000'); await card('stone-piece').getByRole('button', { name: 'Выбросить', exact: true }).click();
  assert.equal(await page.evaluate(() => window.probe.snapshot().view.revision), beforeInvalid);
  await card('stone-piece').getByRole('spinbutton').fill('1');
  await card('iron-sword').getByRole('button', { name: 'Выбросить', exact: true }).click(); await idle();
  assert.equal(await page.evaluate(() => window.probe.snapshot().selectedItems.weak), null);
  await page.getByRole('button', { name: 'Закрыть инвентарь' }).click(); await page.mouse.move(720, 500); await page.keyboard.press('e'); await idle();
  assert.equal(await count('stone-piece'), 80);
  results.checks.push('I opens inventory and pauses controls; sword selection, partial stack drop, validation, retry and pickup conserve items');

  await page.getByRole('button', { name: 'Открыть инвентарь · I', exact: true }).click();
  await page.locator('[data-recipe="place-masonry"]').getByRole('button', { name: 'Выбрать чертёж', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть инвентарь' }).click();
  await canvas.click(); await page.waitForFunction(() => window.probe.noa.container.hasPointerLock);
  await page.evaluate(() => { window.probe.noa.camera.pitch = .45; });
  await page.waitForFunction(() => window.probe.noa.targetedBlock?.position[1] === 3);
  const adjacent = await page.evaluate(() => [...window.probe.noa.targetedBlock.adjacent]);
  await page.mouse.click(720, 500, { button: 'right' }); await idle();
  assert.equal(await count('stone-piece'), 40); assert.equal(await count('tree-resin'), 9);
  assert.equal(await page.evaluate(p => window.probe.snapshot().view.region.blocks.find(block => block.position.x === p[0] && block.position.y === p[1] && block.position.z === p[2])?.blockId, adjacent), 'masonry');
  assert.notEqual(await page.evaluate(p => window.probe.noa.getBlock(...p), adjacent), 0);
  await page.keyboard.press('i'); await page.getByRole('dialog', { name: /Рюкзак/ }).waitFor();
  await card('stone-piece').getByRole('spinbutton').fill('1'); await card('stone-piece').getByRole('button', { name: 'Выбросить', exact: true }).click(); await idle();
  assert.equal(await count('stone-piece'), 39);
  assert.equal(await page.locator('[data-recipe="place-masonry"] button').isDisabled(), true);
  assert.ok((await page.locator('[data-recipe="place-masonry"]').textContent()).includes('39 / 40'));
  results.checks.push('Recipe selection and real right-click place masonry and spend exactly 40 stones + 1 resin; missing materials disable the recipe');
  mkdirSync('.local', { recursive: true }); await page.screenshot({ path: '.local/noa-inventory.png' });

  await reset(); await canvas.click(); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  assert.ok((await hp()) < 100 && (await hp()) > 0);
  await page.keyboard.press('i'); await page.waitForFunction(() => document.querySelector('#inventory-dialog').open);
  const pausedHp = await hp(); await page.waitForTimeout(550); assert.equal(await hp(), pausedHp);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#inventory-dialog').open);
  results.checks.push('Holding LMB mines; opening inventory stops mining; Escape closes the inventory');
  assert.deepEqual(errors, []); results.checks.push('No uncaught browser errors');
  writeFileSync('.local/results.json', JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(results, null, 2));
} finally { await browser?.close(); await vite.close(); }
