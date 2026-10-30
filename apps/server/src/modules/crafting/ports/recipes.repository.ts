import { CraftingRecipe, CraftingProfession, RankProfile } from '@game/core';

export abstract class RecipesRepository {
  abstract progression(): Promise<{ professions: CraftingProfession[]; rankProfiles: RankProfile[] }>;
  abstract list(): Promise<CraftingRecipe[]>;
}
