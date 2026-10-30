import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Content, InventoryCommand, InventoryState, ItemInstance, applyInventoryCommand, availableItemActions, backpackStacks, equipmentBonuses, equipmentAttributeSources, equipmentRequirementBlockers, projectCharacterAttributes } from '@game/core';
import { z } from 'zod';
import { TransactionContext, UnitOfWork } from '../../../shared/application/unit-of-work';
import { CharactersService } from '../../characters/application/characters.service';
import { ContentService } from '../../content/application/content.service';
import { SkillsService } from '../../skills/application/skills.service';
import { InventoryRepository } from '../ports/inventory.repository';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(InventoryRepository) private readonly repository: InventoryRepository,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(SkillsService) private readonly skills: SkillsService,
  ) {}

  /** Creates the owner's backpack and starting items in the character creation transaction. */
  async initialize(ownerId: string, content: Content, context: TransactionContext) {
    const character = await this.characters.get(ownerId, content, context, true);
    await this.repository.ensurePrimary(ownerId, character.inventory, Object.fromEntries(content.items.map(item => [item.id, item.stackLimit])), context);
  }

  async get(ownerId: string) {
    const content = await this.content.get(true);
    return this.transactions.run(async context => {
      const character = await this.characters.get(ownerId, content, context, true);
      await this.repository.ensurePrimary(ownerId, character.inventory, Object.fromEntries(content.items.map(item => [item.id, item.stackLimit])), context);
      const state = await this.repository.load(ownerId, context);
      const groups = content.itemGroups ?? [];
      return {
        ...state, definitions: content.items, groups, statDefinitions: content.statDefinitions,
        items: state.items.map(instance => {
          const definition = content.items.find(item => item.id === instance.itemId);
          const actions = definition ? availableItemActions(instance, state, definition, groups) : [];
          if (definition && content.statDefinitions) {
            const blockers = equipmentRequirementBlockers(definition, character.baseAttributes ?? {}, content.statDefinitions);
            const equip = actions.find(action => action.id === 'equip');
            if (equip && blockers.length) { equip.enabled = false; equip.reason = blockers.join('; '); }
          }
          if (definition?.grantedSkillId && character.learnedSkillIds.includes(definition.grantedSkillId)) {
            const read = actions.find(action => action.id === 'read');
            if (read) { read.enabled = false; read.reason = 'Навык уже известен'; }
          }
          return { ...instance, actions };
        }),
      };
    });
  }

  async stacks(ownerId: string) {
    const state = await this.get(ownerId);
    return backpackStacks(state).map(stack => ({ ...stack, item: state.definitions.find(item => item.id === stack.itemId) ?? null }));
  }

  async instance(id: string) {
    const instance = await this.repository.instance(id);
    if (!instance) throw new NotFoundException('Предмет не найден');
    const view = await this.get(instance.ownerId);
    const current = view.items.find(item => item.id === id);
    if (!current) throw new ConflictException('Предмет перемещён. Повторите запрос.');
    return { ...current, definition: view.definitions.find(item => item.id === current.itemId) ?? null };
  }

  /** Trusted server rewards/scenarios only. Repeated operation IDs do not mint extra items. */
  receive(ownerId: string, itemId: string, quantity: number, operationId: string, inventoryId?: string | null) {
    return this.execute({ type: 'receive', ownerId, itemId, quantity, inventoryId }, operationId);
  }

  /**
   * Loads one owner's state inside a caller's transaction, locking the character and
   * initializing the primary backpack exactly once. Exported for trusted modules such
   * as crafting; never called by controllers directly.
   */
  async state(ownerId: string, content: Content, context: TransactionContext): Promise<InventoryState> {
    const character = await this.characters.get(ownerId, content, context, true);
    await this.repository.ensurePrimary(ownerId, character.inventory, this.limits(content), context);
    return this.repository.load(ownerId, context);
  }

  /** Persists states and refreshes the owner character projections in the caller's transaction. */
  async commit(states: InventoryState[], content: Content, context: TransactionContext) {
    await this.repository.save(states, context);
    for (const state of states) {
      await this.characters.update(state.ownerId, content, character => {
        character.inventory = backpackStacks(state);
        character.equipmentBonuses = equipmentBonuses(state, content.items);
        if (content.statDefinitions) {
          const sources = equipmentAttributeSources(state, content.items);
          character.equipmentModifiers = sources.modifiers; character.equipmentScaling = sources.scaling;
          Object.assign(character, projectCharacterAttributes(character, content));
        }
      }, context);
    }
  }

  async execute(command: InventoryCommand, operationId: string) {
    z.string().uuid().parse(operationId);
    const signature = JSON.stringify(Object.fromEntries(Object.entries(command).sort(([left], [right]) => left.localeCompare(right))));
    const content = await this.content.get(true);
    return this.transactions.run(async context => {
      const receipt = await this.repository.claimOperation(operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException('ID операции уже использован с другими параметрами');
      if (receipt.result) return receipt.result;
      const ownerIds = await this.owners(command, context);
      const states: InventoryState[] = [];
      // Every inventory mutation locks character owners first, in the same order as rewards.
      for (const ownerId of [...new Set(ownerIds)].sort()) {
        states.push(await this.state(ownerId, content, context));
      }
      if ('instanceId' in command && !states.some(state => state.items.some(item => item.id === command.instanceId))) throw new ConflictException('Предмет перемещён. Повторите действие.');
      if (command.type === 'equip' && content.statDefinitions) {
        const state = states.find(state => state.items.some(item => item.id === command.instanceId))!;
        const instance = state.items.find(item => item.id === command.instanceId)!;
        const definition = content.items.find(item => item.id === instance.itemId)!;
        const character = await this.characters.get(state.ownerId, content, context, true);
        const blockers = equipmentRequirementBlockers(definition, character.baseAttributes ?? {}, content.statDefinitions);
        if (blockers.length) throw new BadRequestException(blockers.join('; '));
      }
      let changed: ReturnType<typeof applyInventoryCommand>;
      try { changed = applyInventoryCommand(states, command, content.items, content.itemGroups, randomUUID); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      for (const effect of changed.effects) {
        const granted = await this.skills.grant(effect.ownerId, effect.skillId, context);
        if (!granted.granted) throw new BadRequestException('Навык уже известен; свиток не потрачен');
      }
      await this.commit(changed.states, content, context);
      await this.repository.finishOperation(operationId, changed.result, context);
      return changed.result;
    });
  }

  private limits(content: Content) {
    return Object.fromEntries(content.items.map(item => [item.id, item.stackLimit]));
  }

  private async owners(command: InventoryCommand, context: TransactionContext) {
    if (command.type === 'receive' || command.type === 'create-inventory') return [command.ownerId];
    const instance = await this.repository.instance(command.instanceId, context);
    if (!instance) throw new NotFoundException('Предмет не найден');
    const ids = [instance.ownerId];
    if ('targetInventoryId' in command) {
      const owner = await this.repository.inventoryOwner(command.targetInventoryId, context);
      if (!owner) throw new NotFoundException('Инвентарь не найден');
      ids.push(owner);
    }
    if (command.type === 'merge') {
      const target = await this.repository.instance(command.targetInstanceId, context);
      if (!target) throw new NotFoundException('Целевой предмет не найден');
      ids.push(target.ownerId);
    }
    return ids;
  }
}
