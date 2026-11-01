import type { ItemRank } from '@game/core';
import { effectValue } from '../../../shared/ui/effect-labels';
import type { CraftingRecipeView } from '../model/types';
export function RankPreview({ recipe, ranks }: { recipe: CraftingRecipeView; ranks: ItemRank[] }) {
  return <div className="rank-previews">{recipe.rankPreviews.filter(output => output.chances.length).map(output => <section key={output.itemId} aria-label={output.fixed ? 'Гарантированный ранг' : 'Шансы рангов'}>
    <h4>{output.fixed ? 'Гарантированный ранг' : 'Шансы качества по уровню профессии'}</h4>
    <p className="hint">Уровень предмета: {output.itemLevel ?? 1}. Ранг определяет количество допов.</p>
    <div className="rank-chances">{output.chances.map(chance => {
      const rank = ranks.find(rank => rank.id === chance.rankId);
      return <div key={chance.rankId} style={{ borderColor: rank?.frameColor }}><strong style={{ color: rank?.frameColor }}>{rank?.name ?? chance.rankId}</strong><b>{(chance.chanceBps / 100).toLocaleString('ru')}%</b><small>{rank?.affixCount ?? 0} доп.</small></div>;
    })}</div>
    {output.fixed && <p className="hint">Уровень профессии не меняет ранг этого рецепта. Допы и их величины случайны.</p>}
    {!!output.modifierPreviews?.length && <details><summary>Возможные допы</summary><p className="hint">Диапазон зависит от уровня вещи. Вес — относительная редкость выбора, а не процент наличия на готовой вещи.</p>
      {output.modifierPreviews.map(modifier => <p key={modifier.id}>{modifier.name}: {effectValue(modifier.operation, modifier.minValue, modifier.operation === 'add_percent' || modifier.operation === 'multiply' ? 'basis_points' : 'points')}…{effectValue(modifier.operation, modifier.maxValue, modifier.operation === 'add_percent' || modifier.operation === 'multiply' ? 'basis_points' : 'points')} · вес {modifier.craftWeight} · срабатывание {modifier.activationChanceBps / 100}%</p>)}
    </details>}
  </section>)}</div>;
}
