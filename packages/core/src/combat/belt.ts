import type { Content, ItemStack } from '../types';
import { isBattleConsumable } from '../items';

export const BATTLE_BELT_CAPACITY = 10;
export const DEFAULT_TURN_SECONDS = 30;

/** Select existing bottles once at start; new items cannot refill this belt. */
export function battleBelt(stacks: ItemStack[], content: Content): ItemStack[] {
  let remaining = BATTLE_BELT_CAPACITY;
  return stacks.flatMap(stack => {
    const item = content.items.find(item => item.id === stack.itemId);
    if (!remaining || !item || !isBattleConsumable(item, content.itemGroups)) return [];
    const quantity = Math.min(remaining, stack.quantity);
    remaining -= quantity;
    return quantity > 0 ? [{ ...structuredClone(stack), quantity }] : [];
  });
}
