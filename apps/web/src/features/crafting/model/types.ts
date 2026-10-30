import type { CraftingRecipe, BlindCraftRules, ItemRank, CraftingProfession } from '@game/core';
export interface CraftingRecipeView extends CraftingRecipe {
  available: boolean;
  rankPreviews: { itemId: string; fixed: boolean; chances: { rankId: string; chanceBps: number }[] }[];
}
export interface ProfessionView extends CraftingProfession { level: number; xp: number; xpToNext: number; totalXp: number }
export interface CraftingCatalog { recipes: CraftingRecipeView[]; blind: BlindCraftRules; ranks: ItemRank[]; professions: ProfessionView[] }

