import type { CSSProperties } from 'react';
import type { ItemInstance } from '@game/core';

export function qualityStyle(item?: Pick<ItemInstance, 'quality'>): CSSProperties | undefined {
  return item?.quality ? { borderColor: item.quality.rank.frameColor } : undefined;
}
export function ItemQuality({ item }: { item: Pick<ItemInstance, 'quality'> }) {
  const quality = item.quality;
  if (!quality) return null;
  return <div className="item-quality">
    <span style={{ color: quality.rank.frameColor }}>{quality.rank.name} · база ×{quality.rank.multiplierBps / 10000} · допов: {quality.affixes.length}</span>
    {!!quality.affixes.length && <dl className="item-bonuses">{quality.affixes.map(affix => <div key={affix.effectId}><dt>{affix.name}</dt><dd>{affix.operation === 'multiply' ? '×' : affix.value >= 0 ? '+' : ''}{affix.operation === 'add_percent' ? `${affix.value / 100}%` : affix.operation === 'multiply' ? affix.value / 10000 : affix.value}</dd></div>)}</dl>}
  </div>;
}
