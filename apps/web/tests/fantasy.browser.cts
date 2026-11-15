import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { allocateAttributes, applyAction, combatStatDefinitions, createBoard, createCharacter, defaultCombatFormulaRules, defaultProfessions,
  gatheringCatalog, gatheringView, initialGatheringState, joinBattle, learnSkill, newBattle, possibleMove, seedContent, seedEffectSkills,
  startBattle, type Content, type InventoryState } from '@game/core';

// Browser fixture stays outside the player's database. Commands still use the actual pure combat rules.
test('fantasy interface: all screens, responsive battle, target selection and a complete skill choice', { timeout: 120000 }, async t => {
  const { preview } = await import('vite');
  const vite = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  t.after(() => new Promise<void>((resolve, reject) => { vite.httpServer.closeAllConnections(); vite.httpServer.close(error => error ? reject(error) : resolve()); }));
  const address = vite.httpServer!.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1120 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const content: Content = structuredClone({ ...seedContent, effectsVersion: 1, modifierRulesVersion: 1, statDefinitions: combatStatDefinitions,
    skills: [...seedContent.skills, ...seedEffectSkills], balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules } });
  const account = { id: randomUUID(), name: 'Игрок 1', createdAt: new Date().toISOString() };
  let selected: string | null = null;
  let hero = createCharacter(randomUUID(), 'Алира', content, 'pyromancer');
  hero = allocateAttributes(hero, { intelligence: 3, vitality: 2 }, content); hero.accountId = account.id;
  for (const id of ['strike', 'ember', 'brace']) learnSkill(hero, id, content);
  const enemy = createCharacter(randomUUID(), 'Страж Терна', content, 'duelist'); learnSkill(enemy, 'strike', content);
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const battle = newBattle(randomUUID(), 'Испытание древней цитадели', 'duel', 'on-match', hero, content);
  battle.board = createBoard({}, random);
  joinBattle(battle, enemy, 1); startBattle(battle, () => 0);
  battle.fighters[0].hp = 211; battle.fighters[1].hp = 184;
  battle.fighters[0].skillEnergy = 36; battle.fighters[1].skillEnergy = 52;
  battle.turn = 7; battle.attributeRngState = 1;
  const inventory: InventoryState = { ownerId: hero.id, inventories: [{ id: hero.id, ownerId: hero.id, name: 'Рюкзак', capacity: 50, primary: true }],
    items: hero.inventory.map((stack, i) => ({ id: `item-${i}`, ownerId: hero.id, inventoryId: hero.id, itemId: stack.itemId, quantity: stack.quantity, equippedSlot: null })) };
  const inventoryView = { ...inventory, definitions: content.items, groups: content.itemGroups, items: inventory.items.map(item => ({ ...item, actions: [] })) };
  const session = () => ({ account, characterId: selected, expiresAt: Date.now() + 3600000 });
  const snapshot = () => {
    battle.serverTime = Date.now(); battle.turnDeadlineAt = Date.now() + 30000;
    const result = structuredClone(battle); delete result.pendingBattlefield; delete result.attributeRngState;
    return result;
  };
  await context.route('**/socket.io/**', route => route.fulfill({ status: 503, body: '' }));
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), body = request.postDataJSON();
    const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === '/accounts') return send([account, { ...account, id: randomUUID(), name: 'Игрок 2' }]);
    if (path === '/identity/session') return send(request.method() === 'POST' ? { ...session(), token: 'fantasy-browser' } : session());
    if (path === '/identity/session/character') { selected = body.characterId; return send(session()); }
    if (path === '/characters') return send([hero]);
    if (path === '/content') return send(content);
    if (path === '/parties') return send({ party: null, incoming: [], outgoing: [], players: [], capacity: 6, serverTime: Date.now() });
    if (path === '/social') return send({ revision: 1, visibilityRevision: 1, relationships: [] });
    if (path === '/chat/feed') return send({ messages: [], before: '', after: '', hasMore: false, partyAccess: null });
    if (path.endsWith('/inventories')) return send(inventoryView);
    if (path.endsWith('/crafting')) return send({ recipes: (content.recipes ?? []).filter(recipe => recipe.knownByDefault).map(recipe => ({ ...recipe, available: true, rankPreviews: [] })),
      blind: { successBps: 4000, lossBps: 5000 }, ranks: content.itemRanks ?? [], professions: defaultProfessions.map(profession => ({ ...profession, level: 1, xp: 0, xpToNext: 100, totalXp: 0 })) });
    if (path.endsWith('/gathering')) return send(gatheringView(initialGatheringState(), gatheringCatalog, inventory, content.items));
    if (path === '/world/expeditions/current') return send({ worldId: null, state: null });
    if (path === '/world/cargo') return send([]);
    if (path === '/battles') return send([snapshot()]);
    if (path === `/battles/${battle.id}`) return send(snapshot());
    if (path === `/battles/${battle.id}/actions`) {
      battle.boardMoves = []; applyAction(battle, hero.id, body.action, random); battle.version++;
      return send(snapshot(), 201);
    }
    return send({ message: `Unexpected fixture route: ${path}` }, 404);
  });
  const screenshotDir = process.env.FANTASY_UI_SCREENSHOT_DIR;
  const shot = async (name: string) => { if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, name), fullPage: true }); } };
  const noOverflow = async (name: string) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
  try {
    await page.goto(origin); await page.getByRole('button', { name: /Игрок 1/ }).waitFor();
    await shot('fantasy-entry.png');
    await page.getByRole('button', { name: /Игрок 1/ }).click();
    await page.getByRole('button', { name: /Алира/ }).waitFor(); await shot('fantasy-characters.png');
    await page.getByRole('button', { name: /Алира/ }).click();
    await page.locator('.create-room').waitFor(); await shot('fantasy-arena.png');
    for (const [hash, ready] of [['skills', '.skill-branches'], ['inventory', '.backpack-grid'], ['equipment', '.equipment-workspace'], ['crafting', '.recipe-options'], ['gathering', '.gathering-areas'], ['world', '.world-lobby']]) {
      await page.goto(`${origin}/#${hash}`); await page.locator(ready).waitFor(); await noOverflow(hash); await shot(`fantasy-${hash}.png`);
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(`${hash} mobile`);
      await page.setViewportSize({ width: 1440, height: 1120 });
    }
    await page.goto(`${origin}/#${battle.id}`); await page.locator('.battle-arena').waitFor();
    assert.equal(await page.locator('.tile').count(), 64);
    const target = page.getByRole('button', { name: `Выбрать цель: ${enemy.name}` });
    await target.click(); assert.equal(await target.getAttribute('aria-pressed'), 'true');
    await noOverflow('battle desktop'); await shot('fantasy-battle-desktop.png');
    if (screenshotDir) await page.locator('.battle-arena').screenshot({ path: join(screenshotDir, 'fantasy-battle-arena.png') });
    await page.getByRole('button', { name: 'Посмотреть персонажа ↗', exact: true }).first().click();
    const details = page.getByRole('dialog', { name: hero.name, exact: true }); await details.waitFor();
    await details.getByRole('button', { name: 'Закрыть просмотр персонажа' }).click(); await details.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('battle mobile'); await shot('fantasy-battle-mobile.png');
    if (screenshotDir) await page.locator('.battle-arena').screenshot({ path: join(screenshotDir, 'fantasy-battle-arena-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1120 });
    const move = possibleMove(battle.board)!; assert.ok(move);
    await page.getByRole('button', { name: new RegExp(`строка ${move.from.row + 1}, столбец ${move.from.col + 1}$`) }).click();
    await page.getByRole('button', { name: new RegExp(`строка ${move.to.row + 1}, столбец ${move.to.col + 1}$`) }).click();
    const dialog = page.getByRole('dialog', { name: 'Выберите умение' }); await dialog.waitFor();
    await shot('fantasy-skill-choice.png');
    const energy = battle.fighters[0].skillEnergy!, secondary = battle.pendingBattlefield?.report.generated.count ?? 0;
    await dialog.getByRole('button', { name: /^⚔ Удар|^Удар/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(battle.fighters[0].skillEnergy, Math.min(200, energy - 1 + secondary));
    assert.equal(battle.activeId, enemy.id);
    // A rectangular field must keep its actual dimensions and every cell reachable.
    const rectangular = newBattle(randomUUID(), 'Прямоугольное поле', 'duel', 'on-match', hero, content, { size: { rows: 6, cols: 10 } });
    battle.board = rectangular.board; battle.battlefield = rectangular.battlefield; battle.version++;
    await page.reload(); await page.locator('[aria-label="Игровое поле 6 × 10"]').waitFor();
    assert.equal(await page.locator('.tile').count(), 60); await noOverflow('rectangular field');
    const team = newBattle(battle.id, 'Битва отрядов', 'team', 'on-match', hero, content);
    for (let i = 0; i < 2; i++) joinBattle(team, { ...structuredClone(hero), id: randomUUID(), name: `Союзник ${i + 1}` }, 0);
    for (let i = 0; i < 3; i++) joinBattle(team, { ...structuredClone(enemy), id: randomUUID(), name: `Страж ${i + 1}` }, 1);
    startBattle(team, () => 0); team.fighters[3].hp = 0;
    Object.assign(battle, team, { version: battle.version + 1 });
    await page.reload(); await page.locator('.combatant-card').nth(5).waitFor();
    assert.equal(await page.locator('.combatant-card').count(), 6);
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('team battle mobile');
    assert.deepEqual(errors, []);
  } catch (error) { console.error(error); await shot('fantasy-failure.png'); throw error; }
});
