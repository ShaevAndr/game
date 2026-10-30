import { CharactersService } from '../../characters/application/characters.service';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { applyCraftRecipe, defaultBlindCraftRules, knownRecipes, matchingCraftRecipes, resolveBlindCraft, type BlindCraftReceipt, type InventoryResult, professionProgress, recipeProfession } from '@game/core';
import { z } from 'zod';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { ContentService } from '../../content/application/content.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { CraftingOperationsRepository } from '../ports/crafting-operations.repository';

const applySchema = z.object({ operationId: z.string().uuid() }).strict();
const contentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const blindSchema = z.object({
  operationId: z.string().uuid(),
  materials: z.array(z.object({ itemId: contentId, quantity: z.number().int().min(1).max(99999) }).strict()).min(1).max(10),
}).strict();

@Injectable()
export class CraftingService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(CraftingOperationsRepository) private readonly operations: CraftingOperationsRepository,
    @Inject(CharactersService) private readonly characters: CharactersService,
    private readonly roll: (maxExclusive: number) => number = max => randomInt(0, max),
  ) {}

  async catalog(ownerId?: string) {
    const content = await this.content.get(true);
    const character = ownerId ? await this.characters.get(ownerId, content) : undefined;
    const professions = (content.professions ?? []).map(profession => ({ ...profession, ...professionProgress(character?.craftingProfessionXp?.[profession.id] ?? 0) }));
    return {
      recipes: knownRecipes(content.recipes ?? []).map(recipe => {
        const profession = recipeProfession(recipe, content.items, content);
        const progress = professions.find(entry => entry.id === profession?.id);
        return { ...recipe, professionId: profession?.id, available: (progress?.level ?? 1) >= (recipe.requiredLevel ?? 1),
          rankPreviews: recipe.outputs.map(output => {
            const policy = output.rankPolicy;
            const chances = policy?.mode === 'fixed' ? [{ rankId: policy.rankId, chanceBps: 10000 }]
              : policy?.mode === 'profession' ? content.rankProfiles?.find(profile => profile.id === policy.profileId)?.levels.find(entry => entry.level === (progress?.level ?? 1))?.chances ?? [] : [];
            return { itemId: output.itemId, fixed: policy?.mode === 'fixed', chances };
          }),
        };
      }),
      professions, ranks: content.itemRanks ?? [], blind: content.balance.crafting?.blind ?? defaultBlindCraftRules,
    };
  }

  async apply(ownerId: string, recipeId: string, input: unknown) {
    const { operationId } = applySchema.parse(input);
    const content = await this.content.get(true);
    const signature = JSON.stringify({ type: 'craft', ownerId, recipeId });
    return this.transactions.run<InventoryResult>(async context => {
      const receipt = await this.operations.claimOperation(operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException('ID операции уже использован с другими параметрами');
      if (receipt.result) return receipt.result as InventoryResult;
      const recipe = (content.recipes ?? []).find(value => value.id === recipeId);
      if (!recipe) throw new NotFoundException('Рецепт не найден');
      if (!knownRecipes(content.recipes ?? []).some(value => value.id === recipeId)) throw new BadRequestException('Рецепт неизвестен персонажу');
      const state = await this.inventory.state(ownerId, content, context);
      const character = await this.characters.get(ownerId, content, context, true);
      const xp = { ...character?.craftingProfessionXp };
      let applied: ReturnType<typeof applyCraftRecipe>;
      try { applied = applyCraftRecipe(state, recipe, content.items, randomUUID, { content, xp, roll: this.roll }); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      await this.inventory.commit([applied.state], content, context);
      await this.characters.update(ownerId, content, value => { value.craftingProfessionXp = xp; }, context);
      await this.operations.finishOperation(operationId, applied.result, context);
      return applied.result;
    });
  }

  async blind(ownerId: string, input: unknown) {
    const { operationId, materials } = blindSchema.parse(input);
    const content = await this.content.get(true);
    const sorted = [...materials].sort((left, right) => left.itemId.localeCompare(right.itemId) || left.quantity - right.quantity);
    const signature = JSON.stringify({ type: 'blind', ownerId, materials: sorted });
    return this.transactions.run<BlindCraftReceipt>(async context => {
      const receipt = await this.operations.claimOperation(operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException('ID операции уже использован с другими параметрами');
      if (receipt.result) return receipt.result as BlindCraftReceipt;
      const recipes = content.recipes ?? [];
      if (matchingCraftRecipes(materials, knownRecipes(recipes)).length) throw new BadRequestException('Этим материалам уже соответствует известный рецепт');
      const state = await this.inventory.state(ownerId, content, context);
      const character = await this.characters.get(ownerId, content, context, true);
      const xp = { ...character?.craftingProfessionXp };
      let outcome: ReturnType<typeof resolveBlindCraft>;
      try { outcome = resolveBlindCraft(state, materials, recipes, content.items, content.balance.crafting?.blind ?? defaultBlindCraftRules, randomUUID, this.roll, { content, xp, roll: this.roll }); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      const result: BlindCraftReceipt = outcome.outcome === 'crafted'
        ? { ...outcome.result, outcome: 'crafted' }
        : { outcome: 'nothing', materialsReturned: outcome.materialsReturned };
      if (outcome.state) await this.inventory.commit([outcome.state], content, context);
      if (outcome.outcome === 'crafted') await this.characters.update(ownerId, content, value => { value.craftingProfessionXp = xp; }, context);
      await this.operations.finishOperation(operationId, result, context);
      return result;
    });
  }
}
