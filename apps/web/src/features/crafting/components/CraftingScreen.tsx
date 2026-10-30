import { BlindCraftRules, CraftingRecipe, InventoryView, RecipeIngredient, matchingCraftRecipes } from '@game/core';
import { ItemIcon } from '../../inventory/components/ItemIcon';

interface Props {
  view: InventoryView; catalog: { recipes: CraftingRecipe[]; blind: BlindCraftRules }; selection: Record<string, number>;
  busy: boolean; message: string;
  onQuantity: (itemId: string, quantity: number) => void;
  onCraft: (recipeId: string) => void;
  onExperiment: () => void;
  onRefresh: () => void;
}

export function CraftingScreen({ view, catalog, selection, busy, message, onQuantity, onCraft, onExperiment, onRefresh }: Props) {
  const primary = view.inventories.find(inventory => inventory.primary);
  const name = (itemId: string) => view.definitions.find(item => item.id === itemId)?.name ?? itemId;
  const backpack = view.items.filter(item => item.inventoryId === primary?.id && !item.equippedSlot);
  const totals = new Map<string, number>();
  for (const item of backpack) totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.quantity);
  const materials = [...totals].map(([itemId, quantity]) => ({ itemId, quantity, definition: view.definitions.find(item => item.id === itemId) }))
    .sort((left, right) => name(left.itemId).localeCompare(name(right.itemId), 'ru'));
  const selectionArray: RecipeIngredient[] = Object.entries(selection).filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
  const matches = matchingCraftRecipes(selectionArray, catalog.recipes);
  const inputs = (recipe: CraftingRecipe) => recipe.inputs.map(input => `${input.quantity} × ${name(input.itemId)}`).join(', ');
  const outputs = (recipe: CraftingRecipe) => recipe.outputs.map(output => `${output.quantity} × ${name(output.itemId)}`).join(', ');
  const successChance = `${(catalog.blind.successBps / 100).toFixed(0)}%`;
  const lossChance = `${(catalog.blind.lossBps / 100).toFixed(0)}%`;
  const clear = () => { for (const itemId of Object.keys(selection)) onQuantity(itemId, 0); };

  return <section className="panel crafting-screen">
    <div className="section-heading crafting-heading"><div><div className="section-label">МАСТЕРСКАЯ ГЕРОЯ</div><h2>Крафт</h2></div><button className="ghost" onClick={onRefresh} disabled={busy} aria-label="Обновить кузницу">↻ Обновить</button></div>
    {message && <p className="craft-message" role="status">{message}</p>}
    <div className="crafting-grid">
      <section className="craft-panel" aria-label="Материалы">
        <div className="craft-panel-heading"><h3>Материалы</h3><span>выбрано: {selectionArray.reduce((sum, entry) => sum + entry.quantity, 0)}</span></div>
        {materials.length === 0 && <p className="hint">В рюкзаке нет материалов для крафта.</p>}
        {materials.map(({ itemId, quantity, definition }) => <label key={itemId} className="material-row">
          <span className="material-icon"><ItemIcon item={definition}/></span>
          <span className="material-name"><b>{name(itemId)}</b><small>в рюкзаке: {quantity}</small></span>
          <input type="number" min={0} max={quantity} value={selection[itemId] ?? 0} aria-label={`Количество материала ${name(itemId)}`}
            onChange={event => onQuantity(itemId, Math.max(0, Math.min(quantity, Number(event.target.value) || 0)))}/>
        </label>)}
        {selectionArray.length > 0 && <button className="ghost material-clear" onClick={clear} disabled={busy}>Очистить выбор</button>}
      </section>
      <section className="craft-panel" aria-label="Результаты">
        <div className="craft-panel-heading"><h3>Рецепты</h3></div>
        {matches.map(recipe => <div key={recipe.id} className="recipe-card matched">
          <div><h4>{recipe.name}</h4><p>{recipe.description}</p></div>
          <dl className="recipe-ingredients"><div><dt>Нужно</dt><dd>{inputs(recipe)}</dd></div><div><dt>Получите</dt><dd>{outputs(recipe)}</dd></div></dl>
          <button className="primary" disabled={busy} onClick={() => onCraft(recipe.id)}>Создать</button>
        </div>)}
        {selectionArray.length > 0 && matches.length === 0 && <div className="experiment-card">
          <h4>Эксперимент</h4>
          <p>Известного рецепта для этого набора нет. Можно попробовать вслепую: сервер выберет случайный подходящий рецепт каталога.</p>
          <dl className="recipe-ingredients"><div><dt>Шанс успеха</dt><dd>{successChance}</dd></div><div><dt>При неудаче материалы пропадут</dt><dd>{lossChance}</dd></div></dl>
          <button className="primary" disabled={busy} onClick={onExperiment}>Эксперимент</button>
        </div>}
        {selectionArray.length === 0 && matches.length === 0 && <p className="hint craft-hint">Выберите количество материалов слева — подходящие известные рецепты появятся здесь. Совпадение должно быть точным.</p>}
        <details className="known-recipes"><summary>Все известные рецепты <span>{catalog.recipes.length}</span></summary>
          {catalog.recipes.map(recipe => <div key={recipe.id} className={`recipe-card ${matches.some(match => match.id === recipe.id) ? 'matched' : ''}`}>
            <div><h4>{recipe.name}</h4><p>{recipe.description}</p></div>
            <dl className="recipe-ingredients"><div><dt>Нужно</dt><dd>{inputs(recipe)}</dd></div><div><dt>Получите</dt><dd>{outputs(recipe)}</dd></div></dl>
            {matches.some(match => match.id === recipe.id) && <button className="primary" disabled={busy} onClick={() => onCraft(recipe.id)}>Создать</button>}
          </div>)}
        </details>
      </section>
    </div>
    <p className="crafting-footnote">Крафт списывает материалы и создаёт предметы одной транзакцией. Созданное снаряжение действует со следующего боя.</p>
  </section>;
}
