import { CraftingRecipe } from '@game/core';

export abstract class RecipesRepository {
  abstract list(): Promise<CraftingRecipe[]>;
}
