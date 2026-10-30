import { CraftingRecipe, InventoryView, backpackStacks } from '@game/core';
import { ItemIcon } from '../../inventory/components/ItemIcon';

interface Props {
  view: InventoryView; recipes: CraftingRecipe[]; recipeId: string; busy: boolean;
  onRecipe: (id: string) => void; onCraft: (id: string) => void;
}

export function RecipeWorkshop({ view, recipes, recipeId, busy, onRecipe, onCraft }: Props) {
  const totals = new Map(backpackStacks(view).map(item => [item.itemId, item.quantity]));
  const definition = (itemId: string) => view.definitions.find(item => item.id === itemId);
  const name = (itemId: string) => definition(itemId)?.name ?? itemId;
  const ready = (recipe: CraftingRecipe) => recipe.inputs.every(input => (totals.get(input.itemId) ?? 0) >= input.quantity);
  const recipe = recipes.find(recipe => recipe.id === recipeId);

  return <div className="crafting-grid">
    <section className="craft-panel" aria-label="Известные рецепты">
      <div className="craft-panel-heading"><h3>Известные рецепты</h3><span>{recipes.length}</span></div>
      <p className="hint recipe-intro">Выберите рецепт — справа появятся ячейки необходимых предметов.</p>
      {!recipes.length && <p className="hint">Известных рецептов пока нет.</p>}
      <div className="recipe-options">{recipes.map(entry => <button key={entry.id} className={`recipe-option ${entry.id === recipeId ? 'selected' : ''}`}
        aria-pressed={entry.id === recipeId} disabled={busy} onClick={() => onRecipe(entry.id)}>
        <ItemIcon item={definition(entry.outputs[0]?.itemId)}/>
        <span><strong>{entry.name}</strong><small>{entry.outputs.map(output => `${name(output.itemId)} ×${output.quantity}`).join(', ')}</small><small className={ready(entry) ? 'recipe-ready' : ''}>{ready(entry) ? 'Материалы собраны' : 'Не хватает материалов'}</small></span>
      </button>)}</div>
    </section>
    <section className="craft-panel recipe-workbench" aria-label="Ячейки рецепта">
      {recipe ? <>
        <div className="craft-panel-heading"><h3>{recipe.name}</h3></div>
        <p>{recipe.description}</p>
        <h4>Необходимые предметы</h4>
        <div className="ingredient-slots" role="list" aria-label="Ингредиенты">{recipe.inputs.map(input => {
          const available = totals.get(input.itemId) ?? 0;
          const missing = Math.max(0, input.quantity - available);
          return <div key={input.itemId} role="listitem" className={`ingredient-slot ${missing ? 'missing' : 'filled'}`}>
            <span className="ingredient-icon"><ItemIcon item={definition(input.itemId)}/><b>×{input.quantity}</b></span>
            <strong>{name(input.itemId)}</strong>
            <span>В рюкзаке: {available} / нужно: {input.quantity}</span>
            <small>{missing ? `Не хватает: ${missing}` : 'Готово'}</small>
          </div>;
        })}</div>
        <p className="hint">Ингредиенты подставляются из рюкзака автоматически и расходуются при нажатии «Создать».</p>
        <h4>Результат</h4>
        <div className="recipe-outputs">{recipe.outputs.map(output => <div className="recipe-output" key={output.itemId}><ItemIcon item={definition(output.itemId)}/><span>{name(output.itemId)} <b>×{output.quantity}</b></span></div>)}</div>
        <p className={`recipe-availability ${ready(recipe) ? 'recipe-ready' : ''}`} role="status">{ready(recipe) ? 'Все ингредиенты готовы к крафту.' : 'Соберите недостающие предметы в основном рюкзаке.'}</p>
        <button className="primary" disabled={busy || !ready(recipe)} onClick={() => onCraft(recipe.id)}>Создать</button>
      </> : <div className="recipe-placeholder"><span aria-hidden="true">◇</span><h3>Выберите известный рецепт</h3><p>Здесь появятся ячейки ингредиентов, их количество и результат крафта.</p></div>}
    </section>
  </div>;
}
