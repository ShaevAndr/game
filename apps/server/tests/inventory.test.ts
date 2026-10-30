import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Character, InventoryResult, InventoryState, createCharacter, seedContent } from '@game/core';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { CharactersRepository } from '../src/modules/characters/ports/characters.repository';
import { ContentService } from '../src/modules/content/application/content.service';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { InventoryRepository } from '../src/modules/inventory/ports/inventory.repository';
import { SkillsService } from '../src/modules/skills/application/skills.service';
import { SkillsCatalogService } from '../src/modules/skills/application/skills-catalog.service';
import { TransactionContext, UnitOfWork } from '../src/shared/application/unit-of-work';

function fixture() {
  type State = {
    characters: Record<string, Character>; inventories: Record<string, InventoryState>;
    receipts: Record<string, { signature: string; result: InventoryResult | null }>;
  };
  let state: State = { characters: {}, inventories: {}, receipts: {} };
  let failSave = false;
  const drafts = new Map<TransactionContext, State>();
  const draft = (context: TransactionContext) => {
    const value = drafts.get(context);
    assert.ok(value, 'Inventory and character writes must share a transaction');
    return value;
  };
  const transactions: UnitOfWork = {
    async run<T>(work: (context: TransactionContext) => Promise<T>) {
      const context = { id: Symbol('transaction') };
      const value = structuredClone(state);
      drafts.set(context, value);
      try { const result = await work(context); state = value; return result; }
      finally { drafts.delete(context); }
    },
  };
  const content = { get: async () => structuredClone(seedContent) } as ContentService;
  const characters = new CharactersService({
    async find(id: string, context: TransactionContext, lock: boolean) {
      assert.equal(lock, true);
      return structuredClone(draft(context).characters[id]);
    },
    async save(character: Character, context: TransactionContext) { draft(context).characters[character.id] = structuredClone(character); },
  } as unknown as CharactersRepository, content);
  const skills = new SkillsService(transactions, characters, content, {} as SkillsCatalogService);
  const inventory = new InventoryService(transactions, {
    async ensurePrimary(ownerId, _initial, _limits, context) { assert.ok(draft(context).inventories[ownerId]); },
    // Detached snapshots reproduce the repository contract: mutating a loaded object is not a save.
    async load(ownerId, context) { return structuredClone(draft(context).inventories[ownerId]); },
    async instance(id, context) {
      assert.ok(context);
      return structuredClone(Object.values(draft(context).inventories).flatMap(value => value.items).find(item => item.id === id));
    },
    async inventoryOwner(id, context) {
      assert.ok(context);
      return Object.values(draft(context).inventories).find(value => value.inventories.some(inventory => inventory.id === id))?.ownerId;
    },
    async save(inventories, context) {
      for (const value of inventories) draft(context).inventories[value.ownerId] = structuredClone(value);
      if (failSave) throw new Error('inventory persistence failed');
    },
    async claimOperation(id, signature, context) {
      return draft(context).receipts[id] ??= { signature, result: null };
    },
    async finishOperation(id, result, context) { draft(context).receipts[id].result = structuredClone(result); },
  }, characters, content, skills);
  const seed = (name: string) => {
    const hero = createCharacter(randomUUID(), name, seedContent);
    state.characters[hero.id] = hero;
    state.inventories[hero.id] = {
      ownerId: hero.id, inventories: [{ id: hero.id, ownerId: hero.id, name: 'Рюкзак', capacity: 50, primary: true }],
      items: hero.inventory.map(stack => ({ ...stack, id: randomUUID(), ownerId: hero.id, inventoryId: hero.id, equippedSlot: null })),
    };
    return hero;
  };
  return { inventory, seed, state: () => state, failSave: (value: boolean) => { failSave = value; } };
}

test('inventory service persists equip, replacement and unequip with character projections and replay receipts', async () => {
  const f = fixture(), hero = f.seed('Воин');
  const sword = (await f.inventory.get(hero.id)).items.find(item => item.itemId === 'iron-sword')!;
  const operationId = randomUUID();
  const equipped = await f.inventory.execute({ type: 'equip', instanceId: sword.id }, operationId);
  assert.equal((await f.inventory.get(hero.id)).items.find(item => item.id === sword.id)?.equippedSlot, 'main-hand');
  assert.equal(f.state().characters[hero.id].equipmentBonuses?.attack, 3);
  assert.ok(!f.state().characters[hero.id].inventory.some(stack => stack.itemId === 'iron-sword'));
  assert.deepEqual(await f.inventory.execute({ type: 'equip', instanceId: sword.id }, operationId), equipped);

  const replacement = await f.inventory.receive(hero.id, 'iron-sword', 1, randomUUID());
  await f.inventory.execute({ type: 'equip', instanceId: replacement.itemIds[0] }, randomUUID());
  const replaced = await f.inventory.get(hero.id);
  assert.equal(replaced.items.find(item => item.id === sword.id)?.equippedSlot, null);
  assert.equal(replaced.items.find(item => item.id === replacement.itemIds[0])?.equippedSlot, 'main-hand');
  assert.equal(f.state().characters[hero.id].equipmentBonuses?.attack, 3);
  assert.equal(f.state().characters[hero.id].inventory.find(stack => stack.itemId === 'iron-sword')?.quantity, 1);

  await f.inventory.execute({ type: 'unequip', instanceId: replacement.itemIds[0] }, randomUUID());
  assert.ok((await f.inventory.get(hero.id)).items.every(item => !item.equippedSlot));
  assert.equal(f.state().characters[hero.id].equipmentBonuses?.attack ?? 0, 0);
  assert.equal(f.state().characters[hero.id].inventory.find(stack => stack.itemId === 'iron-sword')?.quantity, 2);
});

test('inventory service persists transfers for both owners and replays deletion without double consumption', async () => {
  const f = fixture(), source = f.seed('Даритель'), target = f.seed('Получатель');
  const ore = (await f.inventory.get(source.id)).items.find(item => item.itemId === 'iron-ore')!;
  const moved = await f.inventory.execute({ type: 'transfer', instanceId: ore.id, targetInventoryId: target.id, quantity: 3 }, randomUUID());
  assert.equal(f.state().characters[source.id].inventory.find(stack => stack.itemId === 'iron-ore')?.quantity, 5);
  assert.equal(f.state().characters[target.id].inventory.find(stack => stack.itemId === 'iron-ore')?.quantity, 11);
  assert.equal((await f.inventory.get(target.id)).items.find(item => item.id === moved.itemIds[0])?.ownerId, target.id);
  const operationId = randomUUID(), command = { type: 'delete' as const, instanceId: moved.itemIds[0], quantity: 3 };
  const removed = await f.inventory.execute(command, operationId);
  assert.deepEqual(await f.inventory.execute(command, operationId), removed);
  assert.ok(!(await f.inventory.get(target.id)).items.some(item => item.id === moved.itemIds[0]));
  assert.equal(f.state().characters[target.id].inventory.find(stack => stack.itemId === 'iron-ore')?.quantity, 8);
});

test('a failed scroll save rolls back the skill and item, then a retry consumes the scroll exactly once', async () => {
  const f = fixture(), hero = f.seed('Ученик');
  const scroll = (await f.inventory.get(hero.id)).items.find(item => item.itemId === 'ember-scroll')!;
  const command = { type: 'read' as const, instanceId: scroll.id }, operationId = randomUUID();
  const before = structuredClone(f.state());
  f.failSave(true);
  await assert.rejects(f.inventory.execute(command, operationId), /inventory persistence failed/);
  assert.deepEqual(f.state(), before);
  f.failSave(false);
  const result = await f.inventory.execute(command, operationId);
  assert.ok(f.state().characters[hero.id].learnedSkillIds.includes('ember'));
  assert.ok(!(await f.inventory.get(hero.id)).items.some(item => item.id === scroll.id));
  assert.ok(!f.state().characters[hero.id].inventory.some(stack => stack.itemId === 'ember-scroll'));
  assert.deepEqual(await f.inventory.execute(command, operationId), result);
});
