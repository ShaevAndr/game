import type { ItemInstance } from '@game/core';
import { useState } from 'react';
import { useCrafting } from './model/useCrafting';
import { CraftingScreen } from './components/CraftingScreen';
import './crafting.css';

interface Props { ownerId: string; busy: boolean; onError: (message: string) => void; run: (task: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void> }

export function CraftingPage({ ownerId, busy, onError, run, onChanged }: Props) {
  const crafting = useCrafting(ownerId, onError);
  const [message, setMessage] = useState('');
  const [createdItems, setCreatedItems] = useState<ItemInstance[]>([]);
  if (!ownerId) return <section className="panel"><h2>Крафт</h2><p>Выберите персонажа.</p></section>;
  if (!crafting.view || !crafting.catalog) return <section className="panel" role="status">Загрузка кузницы…</section>;
  const nameOf = (itemId: string) => crafting.view?.definitions.find(item => item.id === itemId)?.name ?? itemId;
  const craft = (recipeId: string) => void run(async () => {
    setMessage(''); setCreatedItems([]);
    const result = await crafting.craft(recipeId);
    setCreatedItems(result.createdItems ?? []);
    const recipe = crafting.catalog?.recipes.find(value => value.id === recipeId);
    setMessage(`Создано: ${recipe ? recipe.outputs.map(output => `${output.quantity} × ${nameOf(output.itemId)}`).join(', ') : 'предмет'}`);
    await onChanged();
  });
  const experiment = () => void run(async () => {
    setMessage(''); setCreatedItems([]);
    const result = await crafting.experiment();
    if (result.outcome === 'crafted') {
      setCreatedItems(result.createdItems ?? []);
      const names = result.itemIds.map(id => crafting.view?.items.find(item => item.id === id)).filter(Boolean).map(item => nameOf(item!.itemId));
      setMessage(`Эксперимент удался! В рюкзаке: ${names.join(', ') || 'новый предмет'}`);
    } else {
      setMessage(result.materialsReturned ? 'Эксперимент не удался. Материалы возвращены.' : 'Эксперимент не удался. Материалы пропали.');
    }
    await onChanged();
  });
  return <CraftingScreen view={crafting.view} catalog={crafting.catalog} selection={crafting.selection} busy={busy} message={message} createdItems={createdItems}
    onQuantity={crafting.setQuantity} onCraft={craft} onExperiment={experiment}
    onRefresh={() => void run(async () => { await crafting.refresh(); await onChanged(); })}/>;
}
