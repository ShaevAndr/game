import { z } from 'zod';
import type { Item } from './types';
import type { InventoryResult, InventoryState } from './inventory';

export const recipeKinds = ['craft'] as const;
export type RecipeKind = typeof recipeKinds[number];

export interface RecipeIngredient { itemId: string; quantity: number }
export interface CraftingRecipe {
  id: string; name: string; description: string; kind: RecipeKind;
  knownByDefault: boolean;
  inputs: RecipeIngredient[]; outputs: RecipeIngredient[];
}

export interface BlindCraftRules { successBps: number; lossBps: number }
export const defaultBlindCraftRules: BlindCraftRules = { successBps: 4000, lossBps: 5000 };

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const ingredientSchema = z.object({ itemId: idSchema, quantity: z.number().int().min(1).max(99999) }).strict();
export const craftingRecipeSchema = z.object({
  id: idSchema, name: z.string().min(1).max(80), description: z.string().max(500),
  kind: z.literal('craft'), knownByDefault: z.boolean().default(true),
  inputs: z.array(ingredientSchema).min(1).max(10),
  outputs: z.array(ingredientSchema).min(1).max(10),
}).strict();
export const blindCraftRulesSchema = z.object({
  successBps: z.number().int().min(0).max(10000), lossBps: z.number().int().min(0).max(10000),
}).strict();

/** The MVP has no personal recipe book yet: every knownByDefault recipe is known. */
export function knownRecipes(recipes: CraftingRecipe[]): CraftingRecipe[] {
  return recipes.filter(recipe => recipe.knownByDefault);
}

function sameIngredients(left: RecipeIngredient[], right: RecipeIngredient[]): boolean {
  if (left.length !== right.length) return false;
  const totals = (value: RecipeIngredient[]) => {
    const result = new Map<string, number>();
    for (const ingredient of value) result.set(ingredient.itemId, (result.get(ingredient.itemId) ?? 0) + ingredient.quantity);
    return result;
  };
  const leftTotals = totals(left), rightTotals = totals(right);
  if (leftTotals.size !== rightTotals.size) return false;
  for (const [itemId, quantity] of leftTotals) if (rightTotals.get(itemId) !== quantity) return false;
  return true;
}

/** Recipes whose exact input multiset matches the selected materials. */
export function matchingCraftRecipes(selection: RecipeIngredient[], recipes: CraftingRecipe[]): CraftingRecipe[] {
  return recipes.filter(recipe => recipe.kind === 'craft' && sameIngredients(recipe.inputs, selection));
}

/** Consumes ingredient quantities from the primary backpack; throws before touching anything on shortage. */
function consumeIngredients(draft: InventoryState, inputs: RecipeIngredient[], definitions: Item[], result: InventoryResult) {
  const primary = draft.inventories.find(inventory => inventory.primary);
  if (!primary) throw new Error('Рюкзак не найден');
  const name = (itemId: string) => definitions.find(item => item.id === itemId)?.name ?? itemId;
  for (const input of inputs) {
    let remaining = input.quantity;
    const sources = draft.items.filter(item => item.inventoryId === primary.id && !item.equippedSlot && item.itemId === input.itemId)
      .sort((left, right) => left.id.localeCompare(right.id));
    const available = sources.reduce((total, item) => total + item.quantity, 0);
    if (available < remaining) throw new Error(`Недостаточно материала «${name(input.itemId)}»`);
    for (const source of sources) {
      if (remaining === 0) break;
      const taken = Math.min(source.quantity, remaining);
      source.quantity -= taken; remaining -= taken;
      if (source.quantity === 0) { draft.items = draft.items.filter(item => item.id !== source.id); result.deletedItemIds.push(source.id); }
      else result.itemIds.push(source.id);
    }
  }
  return primary;
}

/**
 * Consumes the recipe inputs from the primary backpack and creates the outputs there.
 * Clones its input: a failed craft never partially mutates the caller's state.
 */
export function applyCraftRecipe(state: InventoryState, recipe: CraftingRecipe, definitions: Item[], newId: () => string): { state: InventoryState; result: InventoryResult } {
  const draft = structuredClone(state);
  const result: InventoryResult = { itemIds: [], deletedItemIds: [] };
  const primary = consumeIngredients(draft, recipe.inputs, definitions, result);
  const name = (itemId: string) => definitions.find(item => item.id === itemId)?.name ?? itemId;
  for (const output of recipe.outputs) {
    const definition = definitions.find(item => item.id === output.itemId);
    if (!definition) throw new Error(`Предмет «${name(output.itemId)}» не найден в каталоге`);
    for (let remaining = output.quantity; remaining > 0;) {
      const quantity = Math.min(remaining, definition.stackLimit);
      const instance = { id: newId(), ownerId: draft.ownerId, inventoryId: primary.id, itemId: output.itemId, quantity, equippedSlot: null };
      draft.items.push(instance); result.itemIds.push(instance.id); remaining -= quantity;
    }
  }
  const occupied = draft.items.filter(item => item.inventoryId === primary.id && !item.equippedSlot).length;
  if (occupied > primary.capacity) throw new Error('Рюкзак заполнен');
  return { state: draft, result };
}

export type BlindCraftReceipt =
  | { outcome: 'crafted'; itemIds: string[]; deletedItemIds: string[] }
  | { outcome: 'nothing'; materialsReturned: boolean };
export type BlindCraftOutcome =
  | { outcome: 'crafted'; state: InventoryState; result: InventoryResult }
  | { outcome: 'nothing'; materialsReturned: boolean; state?: InventoryState };
export type CraftingResult = InventoryResult | BlindCraftReceipt;

/**
 * Blind experiment: a random catalog recipe whose inputs match the selection exactly.
 * `roll(maxExclusive)` is injected so tests stay deterministic and receipt replays
 * never reroll. Matching a known recipe is the caller's concern and is rejected earlier.
 * A failed experiment that loses materials returns the consumed state to persist.
 */
export function resolveBlindCraft(
  state: InventoryState, selection: RecipeIngredient[], recipes: CraftingRecipe[], definitions: Item[],
  rules: BlindCraftRules, newId: () => string, roll: (maxExclusive: number) => number,
): BlindCraftOutcome {
  const matches = matchingCraftRecipes(selection, recipes);
  if (!matches.length) return { outcome: 'nothing', materialsReturned: true };
  if (roll(10000) >= rules.successBps) {
    if (roll(10000) >= rules.lossBps) return { outcome: 'nothing', materialsReturned: true };
    const consumed = structuredClone(state);
    const result: InventoryResult = { itemIds: [], deletedItemIds: [] };
    consumeIngredients(consumed, selection, definitions, result);
    return { outcome: 'nothing', materialsReturned: false, state: consumed };
  }
  const recipe = matches[roll(matches.length)];
  return { outcome: 'crafted', ...applyCraftRecipe(state, recipe, definitions, newId) };
}
