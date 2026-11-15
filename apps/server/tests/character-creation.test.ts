import { emptyInventoryReservations } from './helpers/empty-inventory-reservations';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Character, ItemStack, InventoryState, InventoryResult, backpackStacks, receiveInventoryItems, demoAccounts, seedContent } from '@game/core';
import { CharacterCreationService } from '../src/modules/characters/application/character-creation.service';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { CharactersRepository } from '../src/modules/characters/ports/characters.repository';
import { ContentService } from '../src/modules/content/application/content.service';
import { BattleParticipationService } from '../src/modules/battles/application/battle-participation.service';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { InventoryRepository } from '../src/modules/inventory/ports/inventory.repository';
import { SkillsService } from '../src/modules/skills/application/skills.service';
import { TransactionContext, UnitOfWork } from '../src/shared/application/unit-of-work';

function fixture() {
  type State = { characters: Record<string, Character>; backpacks: Record<string, ItemStack[]>; inventories: Record<string, InventoryState>; receipts: Record<string, { signature: string; result: InventoryResult | null }> };
  let state: State = { characters: {}, backpacks: {}, inventories: {}, receipts: {} };
  let failInventory = false;
  const drafts = new Map<TransactionContext, State>();
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
  const repository = {
    async create(character: Character, context: TransactionContext) { draft(context).characters[character.id] = structuredClone(character); },
    async save(character: Character, context: TransactionContext) { draft(context).characters[character.id] = structuredClone(character); },
    async find(id: string, context: TransactionContext, lock: boolean) {
      assert.equal(lock, true);
      return structuredClone(draft(context).characters[id]);
    },
  } as unknown as CharactersRepository;
  const inventories = {
    async ensurePrimary(ownerId: string, initial: ItemStack[], _limits: Record<string, number>, context: TransactionContext) {
      const value = draft(context);
      assert.ok(value.characters[ownerId], 'The owner must exist in this transaction');
      value.backpacks[ownerId] ??= structuredClone(initial);
      value.inventories[ownerId] ??= receiveInventoryItems({ ownerId, inventories: [{ id: ownerId, ownerId, name: 'Рюкзак', capacity: 50, primary: true }], items: [] }, initial, seedContent.items, randomUUID);
      if (failInventory) throw new Error('inventory unavailable');
    },
    async load(ownerId: string, context: TransactionContext) { return structuredClone(draft(context).inventories[ownerId]); },
    async save(inventories: InventoryState[], context: TransactionContext) {
      for (const inventory of inventories) {
        draft(context).inventories[inventory.ownerId] = structuredClone(inventory);
        draft(context).backpacks[inventory.ownerId] = backpackStacks(inventory);
      }
    },
    async claimOperation(id: string, signature: string, context: TransactionContext) { return draft(context).receipts[id] ??= { signature, result: null }; },
    async finishOperation(id: string, result: InventoryResult, context: TransactionContext) { draft(context).receipts[id].result = structuredClone(result); },
  } as unknown as InventoryRepository;
  const characters = new CharactersService(repository, content);
  const inventory = new InventoryService(transactions, inventories, characters, content, {} as SkillsService, { isCharacterInActiveBattle: async () => false } as unknown as BattleParticipationService, emptyInventoryReservations);
  const service = new CharacterCreationService(transactions, characters, inventory, content);
  return { service, state: () => state, failInventory: (value: boolean) => { failInventory = value; } };
}

test('character creation commits a personal starting inventory for each owner', async () => {
  const f = fixture();
  const first = await f.service.create({ name: 'Первый' }, demoAccounts[0].id);
  const second = await f.service.create({ name: 'Второй', templateId: seedContent.characterTemplates[0].id }, demoAccounts[0].id);
  assert.notEqual(first.id, second.id);
  for (const character of [first, second]) {
    assert.deepEqual(f.state().characters[character.id], character);
    assert.equal(character.accountId, demoAccounts[0].id);
    assert.deepEqual(f.state().backpacks[character.id], character.inventory);
    assert.ok(character.inventory.length > 0);
    assert.equal(f.state().inventories[character.id].items.filter(item => item.quality).length, 14);
    for (const itemId of ['woodcutting-axe', 'mining-pick'])
      assert.equal(f.state().backpacks[character.id].filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0), 1);
  }
});

test('a starting inventory failure rolls back both owner and inventory; creation can be retried', async () => {
  const f = fixture();
  await f.service.create({ name: 'Существующий' }, demoAccounts[0].id);
  const before = structuredClone(f.state());
  f.failInventory(true);
  await assert.rejects(f.service.create({ name: 'Новый' }, demoAccounts[0].id), /inventory unavailable/);
  assert.deepEqual(f.state(), before);
  f.failInventory(false);
  const created = await f.service.create({ name: 'Новый' }, demoAccounts[0].id);
  assert.equal(Object.keys(f.state().characters).length, 2);
  assert.deepEqual(f.state().backpacks[created.id], created.inventory);
});

test('invalid character creation does not leave an owner or starting inventory', async () => {
  const f = fixture();
  await assert.rejects(f.service.create({ name: 'Герой', templateId: 'missing-template' }, demoAccounts[0].id));
  assert.deepEqual(f.state(), { characters: {}, backpacks: {}, inventories: {}, receipts: {} });
});
