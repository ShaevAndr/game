import type { WorldRecipePermit } from './types';
export const worldBuildingRecipes = [
  { id: 'stone-masonry', name: 'Каменная кладка', blockId: 'masonry', ingredients: [{ itemId: 'flint', quantity: 4 }, { itemId: 'tree-resin', quantity: 1 }] },
  { id: 'wooden-block', name: 'Деревянный блок', blockId: 'planks', ingredients: [{ itemId: 'oak-wood', quantity: 8 }, { itemId: 'tree-resin', quantity: 1 }] },
];
export const waterFillingRecipe = {
  id: 'fill-water-flask',
  ingredients: [{ itemId: 'clay-flask', quantity: 1 }],
  output: { itemId: 'water-flask', quantity: 1 },
};

export function findWorldRecipe(recipeId: string) {
  return recipeId === waterFillingRecipe.id ? waterFillingRecipe : worldBuildingRecipes.find(entry => entry.id === recipeId);
}

/** Only the gateway may create a permit, after reserving canonical backpack instances. */
export function validateWorldRecipePermit(permit: WorldRecipePermit | undefined, recipeId: string, characterId: string) {
  const recipe = findWorldRecipe(recipeId);
  if (!recipe || !permit || permit.recipeId !== recipeId || permit.ownerCharacterId !== characterId) throw new Error('Материалы рецепта не зарезервированы');
  if (!permit.materials.length || new Set(permit.materials.map(row => row.instanceId)).size !== permit.materials.length
    || new Set(permit.materials.map(row => row.reservationId)).size !== permit.materials.length
    || permit.materials.some(row => !Number.isSafeInteger(row.quantity) || row.quantity < 1 || !recipe.ingredients.some(cost => cost.itemId === row.itemId))
    || recipe.ingredients.some(cost => permit.materials.filter(row => row.itemId === cost.itemId).reduce((sum, row) => sum + row.quantity, 0) !== cost.quantity))
    throw new Error('Резерв не соответствует рецепту мира');
}
