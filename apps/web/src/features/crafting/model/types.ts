import type { CraftingRecipe, BlindCraftRules, ItemRank, CraftingProfession, StatModifier } from '@game/core';
export interface CraftingRecipeView extends CraftingRecipe {
  available: boolean;
  rankPreviews: { itemId: string; itemLevel?: number; fixed: boolean; chances: { rankId: string; chanceBps: number }[]; modifierPreviews?: { id: string; name: string; statId: string; operation: StatModifier['operation']; craftWeight: number; activationChanceBps: number; minValue: number; maxValue: number }[] }[];
}
export interface ProfessionView extends CraftingProfession { level: number; xp: number; xpToNext: number; totalXp: number }
export interface CraftingCatalog { recipes: CraftingRecipeView[]; blind: BlindCraftRules; ranks: ItemRank[]; professions: ProfessionView[] }

