import { professionForItem, professionProgress, qualityForItem } from './item-progression';
import type { Content } from './types';
import { z } from 'zod';
import type { Item } from './types';
import type { InventoryResult, InventoryState } from './inventory';

export const recipeKinds = ['craft'] as const;
export type RecipeKind = typeof recipeKinds[number];

export interface RecipeIngredient { itemId: string; quantity: number }
export type RankPolicy = { mode: 'fixed'; rankId: string } | { mode: 'profession'; profileId: string };
export interface RecipeOutput extends RecipeIngredient { rankPolicy?: RankPolicy }
export interface CraftingRecipe {
  professionId?: string; requiredLevel?: number; xpGain?: number;
  id: string; name: string; description: string; kind: RecipeKind;
  knownByDefault: boolean;
  inputs: RecipeIngredient[]; outputs: RecipeOutput[];
}

export interface BlindCraftRules { successBps: number; lossBps: number }
export const defaultBlindCraftRules: BlindCraftRules = { successBps: 4000, lossBps: 5000 };

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const ingredientSchema = z.object({ itemId: idSchema, quantity: z.number().int().min(1).max(99999) }).strict();
const outputSchema = ingredientSchema.extend({ rankPolicy: z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), rankId: idSchema }).strict(), z.object({ mode: z.literal('profession'), profileId: idSchema }).strict()]).optional() }).strict();
export const craftingRecipeSchema = z.object({
  id: idSchema, name: z.string().min(1).max(80), description: z.string().max(500),
  professionId: idSchema.optional(), requiredLevel: z.number().int().min(1).max(100).optional(), xpGain: z.number().int().min(1).max(1000).optional(),
  kind: z.literal('craft'), knownByDefault: z.boolean().default(true),
  inputs: z.array(ingredientSchema).min(1).max(10),
  outputs: z.array(outputSchema).min(1).max(10),
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
export function matchingCraftRecipes<T extends CraftingRecipe>(selection: RecipeIngredient[], recipes: T[]): T[] {
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
export function applyCraftRecipe(state: InventoryState, recipe: CraftingRecipe, definitions: Item[], newId: () => string, progression?: CraftProgressionContext): { state: InventoryState; result: InventoryResult } {
  if (progression) checkCraftProfession(recipe, definitions, progression);
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
      if (definition.equipSlot && output.rankPolicy && progression) {
        const profession = recipeProfession(recipe, definitions, progression.content);
        Object.assign(instance, { quality: qualityForItem(definition, output.rankPolicy, professionProgress(progression.xp[profession?.id ?? ''] ?? 0).level, progression.content, progression.roll) });
      }
      draft.items.push(instance); result.itemIds.push(instance.id); remaining -= quantity;
    }
  }
  const occupied = draft.items.filter(item => item.inventoryId === primary.id && !item.equippedSlot).length;
  if (occupied > primary.capacity) throw new Error('Рюкзак заполнен');
  if (progression) {
    result.createdItems = structuredClone(draft.items.filter(item => result.itemIds.includes(item.id) && !state.items.some(original => original.id === item.id)));
    awardCraftXp(recipe, definitions, progression);
  }
  return { state: draft, result };
}

export type BlindCraftReceipt =
  | ({ outcome: 'crafted' } & InventoryResult)
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
  rules: BlindCraftRules, newId: () => string, roll: (maxExclusive: number) => number, progression?: CraftProgressionContext,
): BlindCraftOutcome {
  const matches = matchingCraftRecipes(selection, recipes).filter(recipe => {
    if (!progression) return true;
    try { checkCraftProfession(recipe, definitions, progression); return true; } catch { return false; }
  });
  if (!matches.length) return { outcome: 'nothing', materialsReturned: true };
  if (roll(10000) >= rules.successBps) {
    if (roll(10000) >= rules.lossBps) return { outcome: 'nothing', materialsReturned: true };
    const consumed = structuredClone(state);
    const result: InventoryResult = { itemIds: [], deletedItemIds: [] };
    consumeIngredients(consumed, selection, definitions, result);
    return { outcome: 'nothing', materialsReturned: false, state: consumed };
  }
  const recipe = matches[roll(matches.length)];
  return { outcome: 'crafted', ...applyCraftRecipe(state, recipe, definitions, newId, progression) };
}

export interface CraftProgressionContext { content: Content; xp: Record<string, number>; roll: (max: number) => number }
export function recipeProfession(recipe: CraftingRecipe, items: Item[], content: Pick<Content, 'professions'>) {
  return recipe.professionId ? content.professions?.find(profession => profession.id === recipe.professionId)
    : professionForItem(items.find(item => item.id === recipe.outputs[0]?.itemId)!, content);
}
export function checkCraftProfession(recipe: CraftingRecipe, items: Item[], context: CraftProgressionContext) {
  const profession = recipeProfession(recipe, items, context.content);
  if (recipe.professionId && !profession) throw new Error('Профессия не найдена');
  const level = professionProgress(context.xp[profession?.id ?? ''] ?? 0).level;
  if (level < (recipe.requiredLevel ?? 1)) throw new Error(`Нужен уровень профессии ${recipe.requiredLevel}`);
}
function awardCraftXp(recipe: CraftingRecipe, items: Item[], context: CraftProgressionContext) {
  const profession = recipeProfession(recipe, items, context.content);
  if (!profession) return;
  const xp = (context.xp[profession.id] ?? 0) + (recipe.xpGain ?? profession.xpPerCraft);
  professionProgress(xp);
  context.xp[profession.id] = xp;
}
