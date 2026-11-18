import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { allocateAttributes, applyAction, combatStatDefinitions, createBoard, createCharacter, defaultCombatFormulaRules, defaultProfessions,
  gatheringCatalog, gatheringView, gainExperience, initialGatheringState, joinBattle, learnSkill, newBattle, possibleMove, seedContent, seedEffectSkills,
  startBattle, upgradeSkill, type ArenaChallenge, type ArenaState, type Content, type InventoryState } from '@game/core';

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
  const availableRooms = [enemy, { ...enemy, id: randomUUID(), name: 'Другой соперник' }].map(owner => newBattle(randomUUID(), `Дуэль ${owner.name}`, 'duel', 'on-match', owner, content));
  const arena: ArenaState = { incoming: [], outgoing: [], activeBattleId: null };
  const offer = (roomId: string, challengerId: string, recipientId: string): ArenaChallenge => ({ id: randomUUID(), battleId: roomId, roomName: 'Испытание арены',
    challengerId, challengerName: enemy.name, recipientId, recipientName: hero.name, status: 'pending', createdAt: new Date().toISOString() });
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
    if (path === `/characters/${hero.id}/skills`) { learnSkill(hero, body.skillId, content); return send(hero, 201); }
    if (path.endsWith('/upgrade')) { upgradeSkill(hero, path.split('/').at(-2)!, content); return send(hero, 201); }
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
    if (path === `/battles/arena/${hero.id}`) return send(arena);
    if (path.endsWith('/challenges')) {
      const existing = arena.outgoing.find(value => value.battleId === path.split('/')[2]);
      const pending = existing ?? offer(path.split('/')[2], hero.id, enemy.id);
      if (!existing) arena.outgoing.push(pending);
      return send(pending, 201);
    }
    if (path.endsWith('/dismiss')) {
      arena.incoming = arena.incoming.filter(value => value.id !== path.split('/').at(-2));
      arena.outgoing = arena.outgoing.filter(value => value.id !== path.split('/').at(-2));
      return send({ ok: true }, 201);
    }
    if (path.endsWith('/accept')) {
      arena.incoming = []; arena.outgoing = []; arena.activeBattleId = battle.id;
      return send(snapshot(), 201);
    }
    if (path === '/battles') return send(availableRooms);
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
    await page.locator('.rooms').waitFor();
    assert.equal(await page.locator('.create-room, .sidebar, .connection').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Экипировка', exact: true }).count(), 0);
    await shot('fantasy-arena.png');
    await page.getByRole('button', { name: 'Бросить вызов', exact: true }).first().click();
    await page.getByRole('button', { name: 'Вызов отправлен', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Бросить вызов', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.arena-offers .arena-offer').length === 2);
    assert.equal(arena.outgoing.length, 2);
    assert.equal(await page.getByRole('button', { name: 'Вызов отправлен', exact: true }).count(), 2);
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('arena challenges mobile');
    await page.getByRole('button', { name: 'Отозвать', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.arena-offers .arena-offer').length === 1);
    arena.incoming = [offer(battle.id, enemy.id, hero.id)];
    await page.goto(`${origin}/#skills`); await page.reload();
    await page.getByText(`${enemy.name} бросает тебе вызов`).waitFor();
    await noOverflow('arena notification mobile');
    await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
    await page.locator('.arena-notifications').waitFor({ state: 'hidden' });
    arena.incoming = [offer(battle.id, enemy.id, hero.id)];
    await page.reload();
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    await page.locator('.battle-arena').waitFor();
    assert.equal(arena.outgoing.length, 0); assert.equal(arena.incoming.length, 0);
    assert.equal(await page.getByRole('button', { name: 'Начать бой →' }).count(), 0);
    arena.activeBattleId = null;
    await page.setViewportSize({ width: 1440, height: 1120 });
    for (const [hash, ready] of [['skills', '.skill-branches'], ['inventory', '.backpack-grid'], ['attributes', '.attribute-allocation'], ['crafting', '.recipe-options'], ['gathering', '.gathering-areas'], ['world', '.world-lobby']]) {
      await page.goto(`${origin}/#${hash}`); await page.locator(ready).waitFor(); await noOverflow(hash); await shot(`fantasy-${hash}.png`);
      if (hash === 'inventory') {
        assert.equal(await page.locator('.item-details').count(), 0);
        await page.locator('.bag-cell.occupied').first().click();
        await page.getByRole('complementary', { name: 'Свойства предмета' }).waitFor();
      }
      if (hash === 'crafting') {
        assert.equal(await page.locator('.recipe-workbench').count(), 0);
        await page.locator('.recipe-option').first().click(); await page.locator('.ingredient-slots').waitFor();
      }
      if (hash === 'world') assert.equal(await page.locator('.world-deliveries').count(), 0);
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(`${hash} mobile`);
      await page.setViewportSize({ width: 1440, height: 1120 });
    }
    // Learning uses the real rules: choose one root alternative, then one branch member.
    const learner = createCharacter(hero.id, 'Алира', content, 'pyromancer');
    gainExperience(learner, 1000, content.balance.progression);
    hero = allocateAttributes(learner, { intelligence: 10 }, content); hero.accountId = account.id;
    await page.goto(`${origin}/#skills`); await page.reload();
    const card = (id: string) => page.locator(`.skill-tree-card[data-skill-id="${id}"]`);
    await card('phoenix-warmth').waitFor();
    assert.equal(await page.getByRole('tab').count(), 5);
    assert.equal(await page.getByRole('tabpanel').count(), 1);
    assert.ok(await page.locator('.skill-tree-connections path').count() > 0);
    assert.equal(await card('inferno').getByRole('button').isDisabled(), true);
    await card('phoenix-warmth').getByRole('button').click();
    await card('phoenix-warmth').getByText('ИЗУЧЕНО · 1/10', { exact: true }).waitFor();
    assert.equal(await card('burning-brand').getByRole('button').isEnabled(), true);
    await card('burning-brand').getByRole('button').click();
    await card('burning-brand').getByText('ИЗУЧЕНО · 1/10', { exact: true }).waitFor();
    await card('inferno').getByRole('button').click();
    await card('inferno').getByText('ИЗУЧЕНО · 1/10', { exact: true }).waitFor();
    assert.ok(!hero.learnedSkillIds.includes('ember')); assert.ok(!hero.learnedSkillIds.includes('fireball'));
    assert.equal(await card('phoenix-heart').getByRole('button').isDisabled(), true);
    await card('burning-brand').getByRole('button').click();
    await card('burning-brand').getByText('ИЗУЧЕНО · 2/10', { exact: true }).waitFor();
    assert.equal(await card('phoenix-heart').getByRole('button').isDisabled(), true);
    await shot('skills-tree-fire.png');
    await page.getByRole('tab', { name: /Вода/ }).click(); await card('spring').waitFor();
    assert.equal(await card('ember').count(), 0);
    await shot('skills-tree-water.png');
    await page.getByRole('tab', { name: /Вода/ }).press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: /Земля/ }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: /Земля/ }).press('Home'); await card('ember').waitFor();
    await card('healing-flame').getByRole('button').click();
    await card('healing-flame').getByText('ИЗУЧЕНО · 1/10', { exact: true }).waitFor();
    await card('phoenix-heart').getByRole('button').click();
    await card('phoenix-heart').getByText('ИЗУЧЕНО · 1/10', { exact: true }).waitFor();
    assert.equal(hero.skillPoints, 0);
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('skill tree mobile');
    await card('burning-brand').getByText('Требования и действие').click();
    await shot('skills-tree-mobile.png');
    await page.setViewportSize({ width: 1440, height: 1120 });
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
    // An untrained fighter can finish a swap without opening a skill dialog.
    const untrained = battle.fighters.find(fighter => fighter.id === hero.id)!;
    untrained.skillIds = []; battle.activeId = untrained.id; battle.phase = 'before'; battle.usedSkill = false; battle.version++;
    const selectedEnemy = battle.fighters.find(fighter => fighter.hp > 0 && fighter.team !== untrained.team)!;
    const hpBefore = selectedEnemy.hp;
    await page.reload();
    await page.locator('.skill-panel').waitFor();
    await page.getByText(/Навыки не изучены: выберите противника/).waitFor();
    await page.getByRole('button', { name: `Выбрать цель: ${selectedEnemy.name}` }).click();
    const plainMove = possibleMove(battle.board)!; assert.ok(plainMove);
    await page.getByRole('button', { name: new RegExp(`строка ${plainMove.from.row + 1}, столбец ${plainMove.from.col + 1}$`) }).click();
    await page.getByRole('button', { name: new RegExp(`строка ${plainMove.to.row + 1}, столбец ${plainMove.to.col + 1}$`) }).click();
    await page.locator('.journal').getByText(/HP за .* убранных клеток/).waitFor();
    const removed = battle.boardMoves!.filter(report => report.actorId === hero.id).reduce((sum, report) => sum + report.total.count, 0);
    assert.ok(removed > 0); assert.equal(selectedEnemy.hp, Math.max(0, hpBefore - removed));
    assert.equal(await page.getByRole('dialog', { name: 'Выберите умение' }).isVisible(), false);
    await noOverflow('untrained fighter mobile');
    assert.deepEqual(errors, []);
  } catch (error) { console.error(error); await shot('fantasy-failure.png'); throw error; }
});

// Separate browser sessions share only the server fixture; sockets are deliberately unavailable.
test('arena: both accounts enter an accepted duel, restore it after reload and can leave its screen', { timeout: 90000 }, async t => {
  const { preview } = await import('vite');
  const vite = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  t.after(() => new Promise<void>((resolve, reject) => { vite.httpServer.closeAllConnections(); vite.httpServer.close(error => error ? reject(error) : resolve()); }));
  const address = vite.httpServer!.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const ownerBrowser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
  t.after(() => ownerBrowser.close());
  const opponentBrowser = process.env.ARENA_TEST_FIREFOX === '1'
    ? await (await import('playwright')).firefox.launch({ headless: true }) : ownerBrowser;
  if (opponentBrowser !== ownerBrowser) t.after(() => opponentBrowser.close());
  const accounts = ['Хозяин комнаты', 'Второй аккаунт'].map(name => ({ id: randomUUID(), name, createdAt: new Date().toISOString() }));
  const heroes = accounts.map((account, i) => ({ ...createCharacter(randomUUID(), i ? 'Гость' : 'Хозяин', seedContent), accountId: account.id }));
  const offers: ArenaChallenge[] = [], rooms: import('@game/core').Battle[] = [], errors: string[] = [];
  let rejectCancellation = false;
  const battleReads = [0, 0];
  const active = (characterId: string) => rooms.find(room => room.status === 'active' && room.fighters.some(fighter => fighter.characterId === characterId));
  const pages = [];
  for (const [i, browser] of [ownerBrowser, opponentBrowser].entries()) {
    const context = await browser.newContext(); t.after(() => context.close());
    let selected: string | null = null;
    const token = `arena-session-${i}`;
    const session = () => ({ account: accounts[i], characterId: selected, expiresAt: Date.now() + 3600000 });
    await context.route('**/socket.io/**', route => route.fulfill({ status: 503, body: '' }));
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('**/api/v1/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), body = request.postDataJSON();
      const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
      if (path === '/accounts') return send(accounts);
      if (path === '/identity/session' && request.method() === 'POST') {
        assert.equal(body.accountId, accounts[i].id); return send({ ...session(), token }, 201);
      }
      assert.equal(request.headers().authorization, `Bearer ${token}`);
      if (path === '/identity/session') return send(session());
      if (path === '/identity/session/character') { selected = body.characterId; return send(session(), 201); }
      if (path === '/characters') return send([heroes[i]]);
      if (path === '/content') return send(seedContent);
      if (path === '/parties') return send({ party: null, incoming: [], outgoing: [], players: [], capacity: 6, serverTime: Date.now() });
      if (path === '/social') return send({ revision: 1, visibilityRevision: 1, relationships: [] });
      if (path === '/chat/feed') return send({ messages: [], before: '', after: '', hasMore: false, partyAccess: null });
      if (path === `/battles/arena/${heroes[i].id}`) return send({
        incoming: offers.filter(offer => offer.status === 'pending' && offer.recipientId === heroes[i].id),
        outgoing: offers.filter(offer => offer.status === 'pending' && offer.challengerId === heroes[i].id), activeBattleId: active(heroes[i].id)?.id ?? null,
      });
      if (path === '/battles') {
        if (request.method() === 'GET') return send(rooms.filter(room => room.status === 'waiting'));
        assert.equal(body.characterId, heroes[i].id);
        const room = newBattle(randomUUID(), body.name, body.kind, 'on-match', heroes[i], seedContent, body.battlefield);
        rooms.push(room); return send(room, 201);
      }
      const room = rooms.find(value => value.id === path.split('/')[2]);
      if (room && path.endsWith('/cancel')) {
        assert.equal(room.fighters[0].characterId, heroes[i].id);
        assert.equal(room.status, 'waiting');
        if (rejectCancellation) { rejectCancellation = false; return send({ message: 'Не удалось отменить комнату' }, 503); }
        rooms.splice(rooms.indexOf(room), 1);
        for (let index = offers.length - 1; index >= 0; index--) if (offers[index].battleId === room.id) offers.splice(index, 1);
        return send({ ok: true }, 201);
      }
      if (room && path.endsWith('/challenges')) {
        const offer: ArenaChallenge = { id: randomUUID(), battleId: room.id, roomName: room.name, challengerId: heroes[i].id,
          challengerName: heroes[i].name, recipientId: room.fighters[0].characterId!, recipientName: room.fighters[0].name, status: 'pending', createdAt: new Date().toISOString() };
        offers.push(offer); return send(offer, 201);
      }
      if (room && path.endsWith('/accept')) {
        const offer = offers.find(value => value.id === path.split('/').at(-2))!;
        assert.equal(offer.recipientId, heroes[i].id);
        joinBattle(room, heroes.find(hero => hero.id === offer.challengerId)!, 1); startBattle(room, () => 0); room.version++;
        for (const value of offers) value.status = value.id === offer.id ? 'accepted' : 'cancelled';
        return send({ ...room, serverTime: Date.now() }, 201);
      }
      if (room && path === `/battles/${room.id}`) {
        battleReads[i]++;
        return send({ ...room, serverTime: Date.now() });
      }
      if (/^\/battles\/[^/]+$/.test(path)) return send({ message: 'Бой не найден' }, 404);
      errors.push(`Unhandled route: ${path}`); return send({ message: path }, 404);
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); pages.push(page);
    await page.goto(origin);
    await page.getByRole('button', { name: new RegExp(accounts[i].name) }).click();
    await page.getByRole('button', { name: new RegExp(heroes[i].name) }).click();
    await page.locator('.rooms').waitFor();
  }
  const [owner, opponent] = pages;
  await owner.getByRole('button', { name: 'Создать комнату', exact: false }).click();
  await owner.getByRole('button', { name: 'Создать', exact: true }).click();
  await owner.getByText('Твоя комната', { exact: false }).waitFor();
  assert.equal(await owner.locator('.create-room, .battle-arena').count(), 0);
  assert.equal(new URL(owner.url()).hash, '');
  await opponent.getByRole('button', { name: 'Обновить ↻', exact: true }).click();
  await opponent.getByRole('button', { name: 'Бросить вызов', exact: true }).click();
  await opponent.getByRole('button', { name: 'Вызов отправлен', exact: true }).waitFor();
  assert.equal(new URL(opponent.url()).hash, '');
  assert.equal(await opponent.getByRole('button', { name: 'Отменить комнату', exact: true }).count(), 0);
  // The host can cancel even after receiving an offer; a failed command keeps the room available.
  await owner.getByRole('button', { name: 'Принять', exact: true }).waitFor();
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  rejectCancellation = true;
  await owner.getByRole('button', { name: 'Отменить комнату', exact: true }).click();
  await owner.getByText('Не удалось отменить комнату', { exact: false }).waitFor();
  assert.equal(rooms.length, 1); assert.equal(offers.length, 1);
  await owner.getByRole('button', { name: 'Отменить комнату', exact: true }).click();
  await owner.getByText('Пока нет доступных комнат.', { exact: true }).waitFor();
  assert.equal(rooms.length, 0); assert.equal(offers.length, 0);
  await opponent.getByRole('button', { name: 'Отозвать', exact: true }).waitFor({ state: 'hidden' });
  await owner.reload(); await owner.getByText('Пока нет доступных комнат.', { exact: true }).waitFor();
  for (const mode of ['Командный бой', 'Бой с ботом', 'Подземелье']) {
    await owner.getByRole('button', { name: 'Создать комнату', exact: true }).click();
    await owner.locator('.mode-tabs').getByRole('button', { name: new RegExp(mode) }).click();
    await owner.getByRole('button', { name: 'Создать', exact: true }).click();
    await owner.locator('.lobby-actions').getByRole('button', { name: 'Отменить комнату', exact: true }).waitFor();
    if (mode === 'Командный бой') {
      await opponent.goto(owner.url()); await opponent.locator('.battle-arena').waitFor();
      assert.equal(await opponent.getByRole('button', { name: 'Отменить комнату', exact: true }).count(), 0);
    }
    await owner.getByRole('button', { name: 'Отменить комнату', exact: true }).click();
    await owner.locator('.rooms').waitFor();
    assert.equal(new URL(owner.url()).hash, '');
    assert.equal(rooms.length, 0);
    if (mode === 'Командный бой') {
      await opponent.locator('.rooms').waitFor();
      await opponent.getByText('Комната больше недоступна.', { exact: false }).waitFor();
      assert.equal(new URL(opponent.url()).hash, '');
    }
  }
  await owner.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await owner.locator('.mode-tabs').getByRole('button', { name: /^Дуэль/ }).click();
  await owner.getByRole('button', { name: 'Создать', exact: true }).click();
  await owner.getByText('Твоя комната', { exact: false }).waitFor();
  await opponent.getByRole('button', { name: 'Обновить ↻', exact: true }).click();
  await opponent.getByRole('button', { name: 'Бросить вызов', exact: true }).click();
  await owner.getByRole('button', { name: 'Принять', exact: true }).click();
  await opponent.locator('.battle-arena').waitFor();
  const room = rooms[0];
  assert.equal(new URL(owner.url()).hash, `#${room.id}`);
  assert.equal(new URL(opponent.url()).hash, `#${room.id}`);
  for (const page of pages) assert.equal(await page.locator('.combatant-card').count(), 2);
  for (const page of pages) assert.equal(await page.getByRole('button', { name: 'Отменить комнату', exact: true }).count(), 0);
  assert.deepEqual(new Set(room.fighters.map(fighter => fighter.characterId)), new Set(heroes.map(hero => hero.id)));
  // Subsequent polls must preserve deliberate navigation away from the same battle.
  await opponent.getByRole('button', { name: 'Навыки', exact: true }).click();
  await opponent.locator('.skill-branches').waitFor();
  const resumed = opponent.waitForResponse(response => response.url().endsWith(`/battles/arena/${heroes[1].id}`));
  await opponent.evaluate(() => window.dispatchEvent(new Event('focus'))); await resumed;
  await opponent.getByRole('button', { name: 'Перейти в бой', exact: true }).waitFor();
  assert.equal(new URL(opponent.url()).hash, '#skills');
  const readsAfterLeaving = battleReads[1];
  await opponent.waitForTimeout(5500);
  assert.equal(battleReads[1], readsAfterLeaving, 'leaving the battle page stops its REST reconciliation');
  // A fresh page restores the ongoing fight even without a working WebSocket.
  await opponent.reload(); await opponent.locator('.battle-arena').waitFor();
  assert.equal(new URL(opponent.url()).hash, `#${room.id}`);
  assert.deepEqual(errors, []);
});

test('character selection: ownership, creation, retries, reload, switching and an expired pending selection', { timeout: 120000 }, async t => {
  const { preview } = await import('vite');
  const vite = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  t.after(() => new Promise<void>((resolve, reject) => { vite.httpServer.closeAllConnections(); vite.httpServer.close(error => error ? reject(error) : resolve()); }));
  const address = vite.httpServer!.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const content: Content = structuredClone({ ...seedContent, statDefinitions: combatStatDefinitions, balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules } });
  const accounts = ['Первый аккаунт', 'Другой аккаунт', 'Пустой аккаунт'].map(name => ({ id: randomUUID(), name, createdAt: new Date().toISOString() }));
  const heroes = [0, 0, 1].map((index, i) => ({ ...createCharacter(randomUUID(), ['Первый герой', 'Второй герой', 'Чужой герой'][i], content), accountId: accounts[index].id }));
  const sessions = new Map<string, { accountId: string; characterId: string | null }>();
  const expired = new Set<string>();
  let rejectSelection = false, rejectCreation = false, pauseLeave = false, leaveStarted = false;
  let releaseLeave: (() => void) | undefined;
  let lastToken = '', allocations = 0;
  await context.route('**/socket.io/**', route => route.fulfill({ status: 503, body: '' }));
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), body = request.postDataJSON(), method = request.method();
    const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === '/accounts') {
      if (method === 'GET') return send(accounts);
      const account = { id: randomUUID(), name: body.name.trim(), createdAt: new Date().toISOString() }; accounts.push(account); return send(account, 201);
    }
    if (path === '/identity/session' && method === 'POST') {
      lastToken = randomUUID(); sessions.set(lastToken, { accountId: body.accountId, characterId: null });
      return send({ token: lastToken, account: accounts.find(account => account.id === body.accountId), characterId: null, expiresAt: Date.now() + 3600000 }, 201);
    }
    const token = request.headers().authorization?.replace('Bearer ', ''), state = sessions.get(token);
    if (!state || expired.has(token)) return send({ message: 'Сессия завершена' }, 401);
    const session = () => ({ account: accounts.find(account => account.id === state.accountId), characterId: state.characterId, expiresAt: Date.now() + 3600000 });
    if (path === '/identity/session') {
      if (method === 'DELETE') { sessions.delete(token); return send({ ok: true }); }
      return send(session());
    }
    if (path === '/identity/session/character') {
      if (rejectSelection) { rejectSelection = false; return send({ message: 'Выбор временно недоступен' }, 409); }
      if (body.characterId && !heroes.some(hero => hero.id === body.characterId && hero.accountId === state.accountId)) return send({ message: 'Чужой персонаж' }, 403);
      state.characterId = body.characterId;
      const result = session();
      if (pauseLeave && body.characterId === null) { pauseLeave = false; leaveStarted = true; await new Promise<void>(resolve => { releaseLeave = resolve; }); }
      return send(result, 201);
    }
    if (path === '/characters') {
      if (method === 'GET') return send(heroes.filter(hero => hero.accountId === state.accountId));
      if (rejectCreation) { rejectCreation = false; return send({ message: 'Имя уже занято' }, 409); }
      const hero = { ...createCharacter(randomUUID(), body.name, content, body.templateId), accountId: state.accountId }; heroes.push(hero); return send(hero, 201);
    }
    if (path.endsWith('/attributes')) {
      const index = heroes.findIndex(hero => hero.id === path.split('/')[2] && hero.accountId === state.accountId);
      assert.ok(index >= 0); assert.equal(body.expectedRevision, heroes[index].attributeRevision);
      heroes[index] = allocateAttributes(heroes[index], body.allocations, content); allocations++; return send(heroes[index], 201);
    }
    if (path.endsWith('/inventories')) {
      const hero = heroes.find(hero => hero.id === path.split('/')[2] && hero.accountId === state.accountId)!; assert.ok(hero);
      return send({ ownerId: hero.id, inventories: [{ id: hero.id, ownerId: hero.id, name: 'Рюкзак', capacity: 50, primary: true }], items: [], definitions: content.items, groups: content.itemGroups });
    }
    if (path === '/content') return send(content);
    if (path === '/battles') return send([]);
    if (path.startsWith('/battles/arena/')) return send({ incoming: [], outgoing: [], activeBattleId: null });
    if (path === '/parties') return send({ party: null, incoming: [], outgoing: [], players: [], capacity: 6, serverTime: Date.now() });
    if (path === '/social') return send({ revision: 1, visibilityRevision: 1, relationships: [] });
    if (path === '/chat/feed') return send({ messages: [], before: '', after: '', hasMore: false, partyAccess: null });
    errors.push(`Unhandled route: ${path}`); return send({ message: path }, 404);
  });
  const chooseAccount = async (name: string) => {
    await page.getByRole('button', { name: new RegExp(name) }).click(); await page.getByRole('heading', { name: 'Выбери своего героя' }).waitFor();
    await page.getByText('Загрузка персонажей…', { exact: true }).waitFor({ state: 'hidden' });
  };
  const chooseHero = async (name: string) => {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.waitForFunction(name => document.querySelector('.account-controls > span')?.textContent === name, name);
  };
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // A direct link cannot skip account or character selection.
  await page.goto(`${origin}/#attributes`);
  await chooseAccount(accounts[0].name);
  assert.equal(await page.getByRole('button', { name: /Чужой герой/ }).count(), 0);
  assert.equal(await page.locator('.character-choice-card').count(), 2);
  rejectSelection = true;
  await page.getByRole('button', { name: /Первый герой/ }).click();
  await page.getByRole('alert').getByText('Выбор временно недоступен', { exact: false }).waitFor();
  assert.equal(sessions.get(lastToken)?.characterId, null);
  await chooseHero('Первый герой'); await page.locator('.attribute-allocation').waitFor();
  const revision = heroes[0].attributeRevision;
  await page.getByRole('spinbutton', { name: 'Добавить очки: Сила', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Применить характеристики', exact: true }).click();
  await page.getByText('Свободно очков: 3', { exact: true }).waitFor();
  assert.equal(allocations, 1); assert.equal(heroes[0].attributeRevision, revision! + 1);
  await noOverflow(); await page.reload(); await page.locator('.attribute-allocation').waitFor();
  assert.equal(sessions.get(lastToken)?.characterId, heroes[0].id);
  await page.getByRole('button', { name: 'Навыки', exact: true }).click(); await page.locator('.skill-branches').waitFor();
  assert.equal(await page.locator('.attribute-allocation, .equipment-panel, .party-roster, .legend').count(), 0);
  await page.getByRole('button', { name: 'Группа', exact: true }).click();
  await page.getByRole('dialog', { name: 'Группа', exact: true }).waitFor(); await noOverflow();
  await page.getByRole('button', { name: 'Закрыть · Esc', exact: true }).click();
  await page.goto(`${origin}/#equipment`); await page.locator('.backpack-grid').waitFor();
  assert.equal(await page.locator('.attribute-allocation').count(), 0); await noOverflow();
  await page.getByRole('button', { name: 'Персонажи', exact: true }).click();
  await page.getByRole('heading', { name: 'Выбери своего героя' }).waitFor();
  assert.equal(sessions.get(lastToken)?.characterId, null); assert.equal(new URL(page.url()).hash, '');
  await chooseHero('Второй герой'); await page.locator('.rooms').waitFor();
  assert.equal(sessions.get(lastToken)?.characterId, heroes[1].id);
  await page.getByRole('button', { name: 'Сменить аккаунт', exact: true }).click();
  await chooseAccount(accounts[1].name);
  await page.getByRole('button', { name: /Чужой герой/ }).waitFor();
  assert.equal(await page.locator('.character-choice-card').count(), 1);
  assert.equal(await page.getByRole('button', { name: /Первый герой|Второй герой/ }).count(), 0);
  await chooseHero('Чужой герой'); await page.locator('.rooms').waitFor();
  // A selection that succeeded on the server but arrives after expiry must not restore that session.
  pauseLeave = true;
  await page.getByRole('button', { name: 'Персонажи', exact: true }).click();
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => { if (leaveStarted) { clearInterval(timer); clearTimeout(timeout); resolve(); } }, 10);
    const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Leave request did not start')); }, 5000);
  });
  expired.add(lastToken);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading', { name: 'Выбери аккаунт', exact: true }).waitFor();
  await chooseAccount(accounts[2].name);
  const newToken = lastToken;
  await page.getByText('У этого аккаунта пока нет героев.', { exact: false }).waitFor();
  releaseLeave!();
  await page.getByRole('heading', { name: 'Выбери своего героя' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('game-session-token')), newToken);
  rejectCreation = true;
  await page.getByRole('textbox', { name: 'Имя нового героя', exact: true }).fill('Новый герой');
  await page.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
  await page.getByText('Имя уже занято', { exact: false }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Имя нового героя', exact: true }).inputValue(), 'Новый герой');
  await page.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
  await page.getByRole('button', { name: /Новый герой/ }).waitFor();
  assert.equal(sessions.get(newToken)?.characterId, null);
  assert.equal(await page.getByRole('textbox', { name: 'Имя нового героя', exact: true }).inputValue(), '');
  assert.equal(heroes.filter(hero => hero.accountId === accounts[2].id).length, 1);
  await chooseHero('Новый герой'); await page.locator('.rooms').waitFor(); await noOverflow();
  await page.reload(); await page.locator('.rooms').waitFor();
  await page.locator('.account-controls > span').filter({ hasText: 'Новый герой' }).waitFor();
  assert.equal(await page.locator('.account-controls > span').innerText(), 'Новый герой');
  // A revoked token on initial restore still displays the public account list and supports a new login.
  expired.add(newToken); await page.reload();
  await page.getByRole('heading', { name: 'Выбери аккаунт', exact: true }).waitFor();
  await chooseAccount(accounts[0].name);
  await page.getByRole('button', { name: /Первый герой/ }).waitFor();
  assert.deepEqual(errors, []);
});
