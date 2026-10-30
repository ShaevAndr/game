import { useState } from 'react';
import { BlindCraftRules, CraftingRecipe, InventoryView } from '@game/core';
import { RecipeWorkshop } from './RecipeWorkshop';
import { ExperimentWorkshop } from './ExperimentWorkshop';

interface Props {
  view: InventoryView; catalog: { recipes: CraftingRecipe[]; blind: BlindCraftRules }; selection: Record<string, number>;
  busy: boolean; message: string;
  onQuantity: (itemId: string, quantity: number) => void;
  onCraft: (recipeId: string) => void;
  onExperiment: () => void;
  onRefresh: () => void;
}

export function CraftingScreen({ view, catalog, selection, busy, message, onQuantity, onCraft, onExperiment, onRefresh }: Props) {
  const [mode, setMode] = useState<'recipe' | 'experiment'>('recipe');
  const [recipeId, setRecipeId] = useState('');
  return <section className="panel crafting-screen">
    <div className="section-heading crafting-heading"><div><div className="section-label">МАСТЕРСКАЯ ГЕРОЯ</div><h2>Крафт</h2></div><button className="ghost" onClick={onRefresh} disabled={busy} aria-label="Обновить кузницу">↻ Обновить</button></div>
    <div className="craft-mode" aria-label="Способ крафта">
      <button aria-pressed={mode === 'recipe'} disabled={busy} onClick={() => setMode('recipe')}>По известному рецепту</button>
      <button aria-pressed={mode === 'experiment'} disabled={busy} onClick={() => setMode('experiment')}>Эксперимент</button>
    </div>
    {message && <p className="craft-message" role="status">{message}</p>}
    {mode === 'recipe'
      ? <RecipeWorkshop view={view} recipes={catalog.recipes} recipeId={recipeId} busy={busy} onRecipe={setRecipeId} onCraft={onCraft}/>
      : <ExperimentWorkshop view={view} catalog={catalog} selection={selection} busy={busy} onQuantity={onQuantity} onCraft={onCraft} onExperiment={onExperiment}/>}
    <p className="crafting-footnote">Материалы берутся из основного рюкзака. Созданные предметы появятся в нём после крафта. Созданное снаряжение действует со следующего боя.</p>
  </section>;
}
