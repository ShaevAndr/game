import type { useWorld } from '../model/useWorld';
import type { useWorldControls } from '../model/useWorldControls';
import { worldDirections } from '../model/useWorldControls';
import { sameVoxel, voxelKey } from '../model/interaction';

interface Props {
  world: ReturnType<typeof useWorld>;
  controls: ReturnType<typeof useWorldControls>;
}

export function WorldInteraction({ world, controls }: Props) {
  const { view } = world;
  const { position, blockType, selectedBlock, controlsLocked, paused, reason, hit, near,
    selected, setSelected, isLeader, move } = controls;
  if (!view?.region || !position) return null;
  return <div className="world-interaction">
          <article className="panel world-target"><div className="section-label">ДОБЫЧА</div><h3>{blockType?.name ?? 'Выбери свою находку'}</h3>{selectedBlock?.maxHp && <p>HP {selectedBlock.hp} / {selectedBlock.maxHp}</p>}
            <p>{selectedBlock ? `Блок ${selectedBlock.position.x}, ${selectedBlock.position.y}, ${selectedBlock.position.z}` : 'Нажми на блок в 3D-сцене. Добывать можно рядом с отрядом.'}</p>
            {world.inventoryError && <p role="alert">{world.inventoryError}</p>}
            <p className="world-action-reason" aria-live="polite">{reason || 'Инструмент подходит. Можно добывать.'}</p>
            <button className="primary" disabled={controlsLocked || paused || !!reason} onClick={() => { if (selectedBlock) hit(selectedBlock.position); }}>Бить</button>
            <details className="world-nearby"><summary>Блоки рядом · {near.length}</summary><div>{near.map(block => <button className={sameVoxel(block.position, selected) ? 'chosen' : ''} key={voxelKey(block.position)} onClick={() => setSelected(block.position)} aria-pressed={sameVoxel(block.position, selected)}>
              {view.region!.palette.find(entry => entry.id === block.blockId)?.name ?? block.blockId}<small>{block.position.x}, {block.position.y}, {block.position.z}</small></button>)}</div></details>
          </article>
          <article className="panel world-movement"><div className="section-label">ПЕРЕМЕЩЕНИЕ ОТРЯДА</div><h3>{isLeader ? 'Выбирай направление' : 'Следуем за лидером'}</h3><p>{isLeader ? 'WASD — движение в любом направлении. Можно управлять и в прыжке.' : 'Позиция общая для всех. Осматривайся и добывай рядом.'}</p>
            <div className="world-dpad">{worldDirections.map(direction => {
              return <button key={direction.key} className={`world-step world-step-${direction.key}`} aria-label={direction.name} title={direction.name} disabled={!isLeader || controlsLocked} onClick={() => move(direction.dx, direction.dz)}>{direction.icon}</button>;
            })}<span>С</span></div><div className="world-position">Позиция <b>{(position.x * view.region.blockSizeMeters).toFixed(2)} · {(position.y * view.region.blockSizeMeters).toFixed(2)} · {(position.z * view.region.blockSizeMeters).toFixed(2)} м</b></div>
            <button className="ghost" disabled={!isLeader || controlsLocked} onClick={() => move(0, 0, true)}>Прыгнуть</button>
            <button className="ghost" disabled={!isLeader || controlsLocked} onClick={() => world.act({ type: 'leave' })}>← Вернуться на карту</button>
          </article>
        </div>;
}
