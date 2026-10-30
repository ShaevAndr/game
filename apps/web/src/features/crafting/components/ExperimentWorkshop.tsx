import { BlindCraftRules, CraftingRecipe, InventoryView, backpackStacks, matchingCraftRecipes } from '@game/core';
import { ItemIcon } from '../../inventory/components/ItemIcon';

interface Props {
  view: InventoryView; catalog: { recipes: CraftingRecipe[]; blind: BlindCraftRules }; selection: Record<string, number>; busy: boolean;
  onQuantity: (itemId: string, quantity: number) => void; onCraft: (recipeId: string) => void; onExperiment: () => void;
}

export function ExperimentWorkshop({ view, catalog, selection, busy, onQuantity, onCraft, onExperiment }: Props) {
  const definition = (itemId: string) => view.definitions.find(item => item.id === itemId);
  const name = (itemId: string) => definition(itemId)?.name ?? itemId;
  const materials = backpackStacks(view).sort((left, right) => name(left.itemId).localeCompare(name(right.itemId), 'ru'));
  const totals = new Map(materials.map(item => [item.itemId, item.quantity]));
  const selected = Object.entries(selection).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  const valid = selected.length > 0 && selected.every(item => Number.isSafeInteger(item.quantity) && item.quantity <= (totals.get(item.itemId) ?? 0));
  const matches = matchingCraftRecipes(selected, catalog.recipes);
  const clear = () => { for (const itemId of Object.keys(selection)) onQuantity(itemId, 0); };

  return <div className="crafting-grid">
    <section className="craft-panel" aria-label="Материалы эксперимента">
      <div className="craft-panel-heading"><h3>Материалы</h3><span>выбрано: {selected.reduce((sum, item) => sum + item.quantity, 0)}</span></div>
      {!materials.length && <p className="hint">В рюкзаке нет предметов для эксперимента.</p>}
      {materials.map(({ itemId, quantity }) => <label key={itemId} className="material-row">
        <span className="material-icon"><ItemIcon item={definition(itemId)}/></span>
        <span className="material-name"><b>{name(itemId)}</b><small>в рюкзаке: {quantity}</small></span>
        <input type="number" min={0} max={quantity} step={1} disabled={busy} value={selection[itemId] ?? 0} aria-label={`Количество материала ${name(itemId)}`}
          onChange={event => onQuantity(itemId, Math.max(0, Math.min(quantity, Math.floor(Number(event.target.value) || 0))))}/>
      </label>)}
      {selected.length > 0 && <button className="ghost material-clear" onClick={clear} disabled={busy}>Очистить выбор</button>}
    </section>
    <section className="craft-panel" aria-label="Результаты эксперимента">
      <div className="craft-panel-heading"><h3>Результаты</h3></div>
      {matches.map(recipe => <div key={recipe.id} className="recipe-card matched"><h4>{recipe.name}</h4><p>{recipe.description}</p>
        <dl className="recipe-ingredients"><div><dt>Нужно</dt><dd>{recipe.inputs.map(input => `${input.quantity} × ${name(input.itemId)}`).join(', ')}</dd></div><div><dt>Получите</dt><dd>{recipe.outputs.map(output => `${output.quantity} × ${name(output.itemId)}`).join(', ')}</dd></div></dl>
        <button className="primary" disabled={busy || !valid} onClick={() => onCraft(recipe.id)}>Создать</button>
      </div>)}
      {selected.length > 0 && !matches.length && <div className="experiment-card"><h4>Эксперимент</h4>
        <p>Известного рецепта для этого набора нет. Можно попробовать вслепую: сервер выберет случайный подходящий рецепт каталога.</p>
        <dl className="recipe-ingredients"><div><dt>Шанс успеха</dt><dd>{(catalog.blind.successBps / 100).toFixed(0)}%</dd></div><div><dt>При неудаче материалы пропадут</dt><dd>{(catalog.blind.lossBps / 100).toFixed(0)}%</dd></div></dl>
        <button className="primary" disabled={busy || !valid} onClick={onExperiment}>Провести эксперимент</button>
      </div>}
      {!selected.length && <p className="hint">Выберите количество предметов слева. Для известного набора появится рецепт, для остальных — эксперимент с риском потери материалов.</p>}
      {!!selected.length && !valid && <p className="inventory-notice" role="status">В рюкзаке уже нет выбранного количества предметов. Измените или очистите выбор.</p>}
    </section>
  </div>;
}
