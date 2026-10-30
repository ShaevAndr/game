import type { ItemRank } from '@game/core';
import type { CraftingRecipeView } from '../model/types';
export function RankPreview({ recipe, ranks }: { recipe: CraftingRecipeView; ranks: ItemRank[] }) {
  return <div className="rank-previews">{recipe.rankPreviews.filter(output => output.chances.length).map(output => <section key={output.itemId} aria-label={output.fixed ? 'Гарантированный ранг' : 'Шансы рангов'}>
    <h4>{output.fixed ? 'Гарантированный ранг' : 'Шансы качества по уровню профессии'}</h4>
    <div className="rank-chances">{output.chances.map(chance => {
      const rank = ranks.find(rank => rank.id === chance.rankId);
      return <div key={chance.rankId} style={{ borderColor: rank?.frameColor }}><strong style={{ color: rank?.frameColor }}>{rank?.name ?? chance.rankId}</strong><b>{(chance.chanceBps / 100).toLocaleString('ru')}%</b><small>База ×{(rank?.multiplierBps ?? 10000) / 10000} · {rank?.affixCount ?? 0} доп.</small></div>;
    })}</div>
    {output.fixed && <p className="hint">Уровень профессии не меняет ранг этого рецепта. Допы и их величины случайны.</p>}
  </section>)}</div>;
}
