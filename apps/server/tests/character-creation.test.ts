import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Character, ItemStack, seedContent } from '@game/core';
import { CharacterCreationService } from '../src/modules/characters/application/character-creation.service';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { CharactersRepository } from '../src/modules/characters/ports/characters.repository';
import { ContentService } from '../src/modules/content/application/content.service';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { InventoryRepository } from '../src/modules/inventory/ports/inventory.repository';
import { SkillsService } from '../src/modules/skills/application/skills.service';
import { TransactionContext, UnitOfWork } from '../src/shared/application/unit-of-work';

function fixture() {
  type State = { characters: Record<string, Character>; backpacks: Record<string, ItemStack[]> };
  let state: State = { characters: {}, backpacks: {} };
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
    async find(id: string, context: TransactionContext, lock: boolean) {
      assert.equal(lock, true);
      return draft(context).characters[id];
    },
  } as unknown as CharactersRepository;
  const inventories = {
    async ensurePrimary(ownerId: string, initial: ItemStack[], _limits: Record<string, number>, context: TransactionContext) {
      const value = draft(context);
      assert.ok(value.characters[ownerId], 'The owner must exist in this transaction');
      value.backpacks[ownerId] ??= structuredClone(initial);
      if (failInventory) throw new Error('inventory unavailable');
    },
  } as unknown as InventoryRepository;
  const characters = new CharactersService(repository, content);
  const inventory = new InventoryService(transactions, inventories, characters, content, {} as SkillsService);
  const service = new CharacterCreationService(transactions, characters, inventory, content);
  return { service, state: () => state, failInventory: (value: boolean) => { failInventory = value; } };
}

test('character creation commits a personal starting inventory for each owner', async () => {
  const f = fixture();
  const first = await f.service.create({ name: 'Первый' });
  const second = await f.service.create({ name: 'Второй', templateId: seedContent.characterTemplates[0].id });
  assert.notEqual(first.id, second.id);
  for (const character of [first, second]) {
    assert.deepEqual(f.state().characters[character.id], character);
    assert.deepEqual(f.state().backpacks[character.id], character.inventory);
    assert.ok(character.inventory.length > 0);
  }
});

test('a starting inventory failure rolls back both owner and inventory; creation can be retried', async () => {
  const f = fixture();
  await f.service.create({ name: 'Существующий' });
  const before = structuredClone(f.state());
  f.failInventory(true);
  await assert.rejects(f.service.create({ name: 'Новый' }), /inventory unavailable/);
  assert.deepEqual(f.state(), before);
  f.failInventory(false);
  const created = await f.service.create({ name: 'Новый' });
  assert.equal(Object.keys(f.state().characters).length, 2);
  assert.deepEqual(f.state().backpacks[created.id], created.inventory);
});

test('invalid character creation does not leave an owner or starting inventory', async () => {
  const f = fixture();
  await assert.rejects(f.service.create({ name: 'Герой', templateId: 'missing-template' }));
  assert.deepEqual(f.state(), { characters: {}, backpacks: {} });
});
