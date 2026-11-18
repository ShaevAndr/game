import type { WorldAction, WorldExpeditionView } from '@game/core';

interface Props {
  view: WorldExpeditionView;
  controlsLocked: boolean;
  isLeader: boolean;
  onAction: (action: WorldAction) => unknown;
}

export function WorldMap({ view, controlsLocked, isLeader, onAction }: Props) {
  return <details className="panel world-map-panel" open={!view.region}><summary><span>Карта экспедиции</span><small>{view.region ? 'Покинь участок, чтобы выбрать путь' : 'Выбирай соседние клетки'}</small></summary>
        <div className="world-map" role="group" aria-label="Карта экспедиции" style={{ gridTemplateColumns: `repeat(${Math.max(...view.map.map(cell => cell.x)) + 1}, minmax(0, 1fr))` }}>{[...view.map].sort((a, b) => a.z - b.z || a.x - b.x).map(cell => {
          const current = view.location?.cellId === cell.id, origin = view.map.find(entry => entry.id === view.location?.cellId);
          const adjacent = !!origin && Math.abs(origin.x - cell.x) + Math.abs(origin.z - cell.z) === 1;
          const name = view.biomes.find(biome => biome.id === cell.biomeId)?.name ?? cell.biomeId;
          return <button key={cell.id} className={`world-map-cell${current ? ' current' : ''}`} aria-label={`${name}, ${cell.x + 1}:${cell.z + 1}${current ? ', отряд здесь' : ''}`} aria-current={current ? 'location' : undefined} disabled={controlsLocked || !isLeader || !!view.region || !current && !adjacent}
            onClick={() => onAction(current ? { type: 'enter' } : { type: 'travel', cellId: cell.id })}><span aria-hidden="true">{current ? '⚑' : '♣'}</span><strong>{name}</strong><small>{current ? 'Войти в участок →' : `${cell.x + 1} : ${cell.z + 1}`}</small></button>;
        })}</div>
        {!isLeader && <p className="hint">Отряд перемещает лидер. Ты войдёшь в участок вместе с ним.</p>}
      </details>;
}
