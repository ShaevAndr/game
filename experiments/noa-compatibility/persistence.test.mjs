import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { openStore } from './store.mjs';
import { createProbe } from './probe.mjs';
const fixture = JSON.parse(readFileSync(new URL('./world-view.json', import.meta.url)));

test('isolated Mongo catalog and aggregate preserve item drops, receipts and recipes across restart and concurrent writes', async () => {
  const database = `test_noa_${randomUUID().replaceAll('-', '')}`, url = process.env.NOA_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
  const admin = new MongoClient(url, { serverSelectionTimeoutMS: 5000 }); await admin.connect();
  const opened = [];
  try {
    let store = await openStore({ database, url }); opened.push(store);
    let catalog = await store.catalog();
    assert.equal(catalog.items.find(item => item.id === 'stone').worldObject.drops.find(row => row.itemId === 'gold-ore').chanceBps, 100);
    let probe = createProbe(fixture, { catalog }); await store.save(probe.exportState(), null);
    const stone = probe.snapshot().inventory.strong.find(item => item.itemId === 'stone-piece');
    const drop = { type: 'drop', actor: 'strong', operationId: 'durable-drop', instanceId: stone.id, quantity: 7 };
    probe.execute(drop); await store.save(probe.exportState(), 0); await store.close();
    store = await openStore({ database, url }); opened.push(store);
    probe = createProbe(fixture, { catalog: await store.catalog(), state: await store.load() });
    const before = probe.exportState(); probe.execute(drop); assert.deepEqual(probe.exportState(), before);
    assert.equal(probe.snapshot().inventory.strong.find(item => item.itemId === 'stone-piece').quantity, 73);
    await assert.rejects(store.save(probe.exportState(), 0), /Состояние изменилось/);

    // Edit database definitions, not code: guaranteed gold and a cheaper construction recipe.
    await admin.db(database).collection('items').updateOne({ id: 'stone' }, { $set: { 'worldObject.drops': [{ itemId: 'gold-ore', min: 2, max: 2, chanceBps: 10000 }] } });
    await admin.db(database).collection('recipes').updateOne({ id: 'place-masonry' }, { $set: { ingredients: [{ itemId: 'stone-piece', quantity: 2 }, { itemId: 'tree-resin', quantity: 1 }] } });
    await store.close(); store = await openStore({ database, url }); opened.push(store);
    catalog = await store.catalog(); let now = 0;
    probe = createProbe(fixture, { catalog, state: await store.load(), clock: () => now });
    for (let i = 0; i < 4; i++) { probe.execute({ type: 'hit', actor: 'strong', operationId: `db-hit-${i}`, position: { x: 6, y: 4, z: 8 } }); now += 250; }
    assert.ok(probe.snapshot().drops.some(pile => pile.itemId === 'gold-ore' && pile.quantity === 2));
    probe.execute({ type: 'place', actor: 'strong', operationId: 'db-build', recipeId: 'place-masonry', position: { x: 7, y: 3, z: 6 } });
    assert.equal(probe.snapshot().inventory.strong.find(item => item.itemId === 'stone-piece').quantity, 71);
    await store.save(probe.exportState(), 1);

    const saved = await store.load(), a = createProbe(fixture, { catalog, state: saved }), b = createProbe(fixture, { catalog, state: saved });
    const instanceId = a.snapshot().inventory.strong.find(item => item.itemId === 'stone-piece').id;
    a.execute({ type: 'drop', actor: 'strong', operationId: 'race-a', instanceId, quantity: 1 });
    b.execute({ type: 'drop', actor: 'strong', operationId: 'race-b', instanceId, quantity: 2 });
    const results = await Promise.allSettled([store.save(a.exportState(), saved.revision), store.save(b.exportState(), saved.revision)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const committed = await store.load();
    assert.equal(committed.revision, saved.revision + 1);
    assert.ok([69, 70].includes(committed.inventory.strong.find(item => item.itemId === 'stone-piece').quantity));
  } finally {
    for (const store of opened) await store.close();
    await admin.db(database).dropDatabase(); await admin.close();
  }
});
