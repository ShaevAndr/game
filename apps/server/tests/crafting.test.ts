import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Character, CraftingResult, createCharacter, seedContent, InventoryState } from '@game/core';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { CharactersRepository } from '../src/modules/characters/ports/characters.repository';
import { ContentService } from '../src/modules/content/application/content.service';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { InventoryRepository } from '../src/modules/inventory/ports/inventory.repository';
import { SkillsService } from '../src/modules/skills/application/skills.service';
import { CraftingService } from '../src/modules/crafting/application/crafting.service';
import { CraftingOperationsRepository } from '../src/modules/crafting/ports/crafting-operations.repository';
import { TransactionContext, UnitOfWork } from '../src/shared/application/unit-of-work';

function fixture(roll: (maxExclusive: number) => number = () => 0) {
  type Draft = { characters: Record<string, Character>; states: Record<string, InventoryState>; receipts: Record<string, { signature: string; result: CraftingResult | null }> };
  let state: Draft = { characters: {}, states: {}, receipts: {} };
  const drafts = new Map<TransactionContext, Draft>();
  const draft = (context: TransactionContext) => {
    const value = drafts.get(context);
    assert.ok(value, 'Writes must share the active transaction');
    return value;
  };
  const transactions: UnitOfWork = {
    async run<T>(work: (context: TransactionContext) => Promise<T>) {
      const context = { id: Symbol('transaction') };
      const value = structuredClone(state);
      drafts.set(context, value);
      try {
        const result = await work(context);
        state = value;
        return result;
      } finally { drafts.delete(context); }
    },
  };
  const content = { get: async () => structuredClone(seedContent) } as ContentService;
  const charactersRepository = {
    async create(character: Character, context: TransactionContext) { draft(context).characters[character.id] = structuredClone(character); },
    async find(id: string, context: TransactionContext, lock: boolean) {
      assert.equal(lock, true);
      return structuredClone(draft(context).characters[id]);
    },
    async save(character: Character, context: TransactionContext) { draft(context).characters[character.id] = structuredClone(character); },
  } as unknown as CharactersRepository;
  const characters = new CharactersService(charactersRepository, content);
  const inventoryRepository = {
    async ensurePrimary(ownerId: string, initial: { itemId: string; quantity: number }[], _limits: Record<string, number>, context: TransactionContext) {
      const value = draft(context);
      assert.ok(value.characters[ownerId], 'The owner must exist in this transaction');
      if (value.states[ownerId]) return;
      value.states[ownerId] = {
        ownerId, inventories: [{ id: ownerId, ownerId, name: 'Рюкзак', capacity: 50, primary: true }],
        items: initial.map(stack => ({ id: randomUUID(), ownerId, inventoryId: ownerId, itemId: stack.itemId, quantity: stack.quantity, equippedSlot: null })),
      };
    },
    async load(ownerId: string, context: TransactionContext) { return structuredClone(draft(context).states[ownerId]); },
    async save(states: InventoryState[], context: TransactionContext) {
      for (const value of states) draft(context).states[value.ownerId] = structuredClone(value);
    },
  } as unknown as InventoryRepository;
  const inventory = new InventoryService(transactions, inventoryRepository, characters, content, {} as SkillsService);
  const operations = {
    async claimOperation(id: string, signature: string, context: TransactionContext) {
      const value = draft(context);
      value.receipts[id] ??= { signature, result: null };
      return value.receipts[id];
    },
    async finishOperation(id: string, result: CraftingResult, context: TransactionContext) {
      draft(context).receipts[id] = { ...draft(context).receipts[id], result: structuredClone(result) };
    },
  } as unknown as CraftingOperationsRepository;
  const crafting = new CraftingService(transactions, content, inventory, operations, roll);
  const seed = async (name: string, stacks: [string, number][]) => {
    const character = createCharacter(randomUUID(), name, seedContent);
    character.inventory = stacks.map(([itemId, quantity]) => ({ itemId, quantity }));
    await transactions.run(async context => { draft(context).characters[character.id] = structuredClone(character); });
    return character;
  };
  const totals = (ownerId: string, itemId: string) => {
    const inventory = state.states[ownerId];
    if (inventory) return inventory.items.filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0);
    return state.characters[ownerId]?.inventory.find(stack => stack.itemId === itemId)?.quantity ?? 0;
  };
  return { crafting, seed, totals, character: (id: string) => state.characters[id], state: () => state };
}

test('apply crafts a known recipe atomically and refreshes the character projection', async () => {
  const f = fixture();
  const hero = await f.seed('Кузнец', [['iron-ore', 8]]);
  const result = await f.crafting.apply(hero.id, 'craft-iron-sword', { operationId: randomUUID() });
  assert.ok(result.itemIds.length > 0);
  assert.equal(f.totals(hero.id, 'iron-ore'), 2);
  assert.equal(f.totals(hero.id, 'iron-sword'), 1);
  assert.deepEqual(f.character(hero.id).inventory, [{ itemId: 'iron-ore', quantity: 2 }, { itemId: 'iron-sword', quantity: 1 }]);
});

test('unknown recipes and missing catalog entries are rejected without touching materials', async () => {
  const f = fixture();
  const hero = await f.seed('Искатель', [['healing-herb', 3], ['iron-ore', 2]]);
  await assert.rejects(f.crafting.apply(hero.id, 'craft-ember-scroll', { operationId: randomUUID() }), /Рецепт неизвестен/);
  await assert.rejects(f.crafting.apply(hero.id, 'missing-recipe', { operationId: randomUUID() }), /Рецепт не найден/);
  assert.equal(f.totals(hero.id, 'healing-herb'), 3);
  assert.equal(f.totals(hero.id, 'iron-ore'), 2);
  assert.deepEqual(f.state().receipts, {});
});

test('insufficient materials are rejected atomically and the attempt can be retried', async () => {
  const f = fixture();
  const hero = await f.seed('Подмастерье', [['iron-ore', 5]]);
  await assert.rejects(f.crafting.apply(hero.id, 'craft-iron-sword', { operationId: randomUUID() }), /Недостаточно материала/);
  assert.equal(f.totals(hero.id, 'iron-ore'), 5);
  assert.equal(f.character(hero.id).inventory[0].quantity, 5);
});

test('replaying an operationId returns the stored result without double consumption', async () => {
  const f = fixture();
  const hero = await f.seed('Ремесленник', [['iron-ore', 8]]);
  const operationId = randomUUID();
  const first = await f.crafting.apply(hero.id, 'craft-iron-sword', { operationId });
  const second = await f.crafting.apply(hero.id, 'craft-iron-sword', { operationId });
  assert.deepEqual(second, first);
  assert.equal(f.totals(hero.id, 'iron-ore'), 2);
  assert.equal(f.totals(hero.id, 'iron-sword'), 1);
  await assert.rejects(f.crafting.apply(hero.id, 'brew-potion', { operationId }), /ID операции уже использован/);
  assert.equal(f.totals(hero.id, 'iron-ore'), 2);
});

test('blind experiment with no matching recipe returns materials untouched', async () => {
  const f = fixture();
  const hero = await f.seed('Химик', [['iron-ore', 5]]);
  const result = await f.crafting.blind(hero.id, { operationId: randomUUID(), materials: [{ itemId: 'iron-ore', quantity: 5 }] });
  assert.deepEqual(result, { outcome: 'nothing', materialsReturned: true });
  assert.equal(f.totals(hero.id, 'iron-ore'), 5);
});

test('blind experiment refuses materials that match a known recipe', async () => {
  const f = fixture();
  const hero = await f.seed('Кузнец', [['iron-ore', 6]]);
  await assert.rejects(f.crafting.blind(hero.id, { operationId: randomUUID(), materials: [{ itemId: 'iron-ore', quantity: 6 }] }), /известный рецепт/);
  assert.equal(f.totals(hero.id, 'iron-ore'), 6);
});

test('blind experiment success crafts the unknown recipe and persists the result', async () => {
  const rolls: number[] = [];
  const f = fixture(max => { rolls.push(max); return 0; });
  const hero = await f.seed('Экспериментатор', [['healing-herb', 3], ['iron-ore', 2]]);
  const result = await f.crafting.blind(hero.id, { operationId: randomUUID(), materials: [{ itemId: 'healing-herb', quantity: 3 }, { itemId: 'iron-ore', quantity: 2 }] });
  assert.deepEqual(rolls, [10000, 1]);
  assert.equal(result.outcome, 'crafted');
  assert.equal(f.totals(hero.id, 'ember-scroll'), 1);
  assert.equal(f.totals(hero.id, 'healing-herb'), 0);
  assert.equal(f.totals(hero.id, 'iron-ore'), 0);
});

test('blind experiment failure loses materials per the roll and replays without rerolling', async () => {
  const values = [5000, 4000];
  const f = fixture(max => values.shift() ?? 0);
  const hero = await f.seed('Неудачник', [['healing-herb', 3], ['iron-ore', 2]]);
  const operationId = randomUUID();
  const result = await f.crafting.blind(hero.id, { operationId, materials: [{ itemId: 'healing-herb', quantity: 3 }, { itemId: 'iron-ore', quantity: 2 }] });
  assert.deepEqual(result, { outcome: 'nothing', materialsReturned: false });
  assert.equal(f.totals(hero.id, 'healing-herb'), 0);
  assert.equal(f.totals(hero.id, 'iron-ore'), 0);
  const replay = await f.crafting.blind(hero.id, { operationId, materials: [{ itemId: 'healing-herb', quantity: 3 }, { itemId: 'iron-ore', quantity: 2 }] });
  assert.deepEqual(replay, result);
  assert.equal(f.totals(hero.id, 'healing-herb'), 0);
});
