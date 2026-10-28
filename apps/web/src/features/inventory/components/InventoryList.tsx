import { Item, ItemStack } from '@game/core';

export function InventoryList({ stacks, items, inBattle }: { stacks: ItemStack[]; items: Item[]; inBattle: boolean }) {
  return <>
    <div className="inventory-label">ИНВЕНТАРЬ {inBattle ? 'В БОЮ' : ''}</div>
    {stacks.map(stack => <div className="inventory" key={stack.itemId}>
      <span>✚ {items.find(item => item.id === stack.itemId)?.name ?? stack.itemId}</span><b>×{stack.quantity}</b>
    </div>)}
  </>;
}
