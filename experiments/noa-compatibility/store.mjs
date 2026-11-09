import { MongoClient } from 'mongodb';
import seed from './catalog.json' with { type: 'json' };
import { validateCatalog } from './probe.mjs';

export async function openStore({ memory = false, url = process.env.NOA_MONGO_URL ?? 'mongodb://127.0.0.1:27017', database = process.env.NOA_MONGO_DB ?? 'noa_sandbox' } = {}) {
  if (memory) {
    let saved = null;
    return { catalog: async () => structuredClone(seed), load: async () => structuredClone(saved),
      save: async (state, expected) => { if ((saved?.revision ?? null) !== expected) throw new Error('Состояние стенда изменилось'); saved = structuredClone(state); }, close: async () => {} };
  }
  if (!/^(noa_sandbox|test_noa_[a-f0-9]+)$/.test(database)) throw new Error('Стенду разрешена только отдельная база noa_sandbox или изолированная test_noa_*');
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(database), worlds = db.collection('worlds');
  try {
    for (const [collection, rows] of [['items', seed.items], ['recipes', seed.recipes]]) {
      await db.collection(collection).createIndex({ id: 1 }, { unique: true });
      await db.collection(collection).bulkWrite(rows.map(row => ({ updateOne: { filter: { id: row.id }, update: { $setOnInsert: row }, upsert: true } })));
    }
    await db.collection('settings').updateOne({ id: 'starting-items' }, { $setOnInsert: { id: 'starting-items', items: seed.startingItems } }, { upsert: true });
  } catch (error) { await client.close(); throw error; }
  return {
    async catalog() {
      const [items, recipes, settings] = await Promise.all([
        db.collection('items').find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
        db.collection('recipes').find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
        db.collection('settings').findOne({ id: 'starting-items' }),
      ]);
      return validateCatalog({ items, recipes, startingItems: settings.items });
    },
    async load() { return (await worlds.findOne({ _id: 'sandbox' }))?.state ?? null; },
    async save(state, expected) {
      if (expected === null) { await worlds.insertOne({ _id: 'sandbox', revision: state.revision, state }); return; }
      const result = await worlds.replaceOne({ _id: 'sandbox', revision: expected }, { _id: 'sandbox', revision: state.revision, state });
      if (result.matchedCount !== 1) throw Object.assign(new Error('Состояние изменилось. Обнови стенд и повтори действие'), { code: 'REVISION_CONFLICT' });
    },
    close: () => client.close(),
  };
}
