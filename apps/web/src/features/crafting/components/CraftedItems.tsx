import type { Item, ItemInstance } from '@game/core';
import { ItemIcon } from '../../inventory/components/ItemIcon';
import { ItemQuality, qualityStyle } from '../../inventory/components/ItemQuality';
export function CraftedItems({ items, definitions }: { items: ItemInstance[]; definitions: Item[] }) {
  if (!items.length) return null;
  return <section className="crafted-items" aria-label="Результат последнего крафта"><h3>Созданные предметы</h3><div>{items.map(item => {
    const definition = definitions.find(entry => entry.id === item.itemId);
    return <article key={item.id} style={qualityStyle(item)}><div className="crafted-title"><ItemIcon item={definition}/><strong>{definition?.name ?? item.itemId}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</strong></div><ItemQuality item={item}/></article>;
  })}</div></section>;
}
