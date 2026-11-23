import { lazy, Suspense } from 'react';
import type { WorldInputFrame } from '@game/core';
import type { useWorld } from '../model/useWorld';
import type { useWorldControls } from '../model/useWorldControls';
import { WorldLoadout } from './WorldLoadout';
import { WorldInteraction } from './WorldInteraction';
const Viewport = lazy(() => import('./WorldViewport').then(module => ({ default: module.WorldViewport })));

interface Props {
  world: ReturnType<typeof useWorld>;
  controls: ReturnType<typeof useWorldControls>;
  onInventory: () => void;
}

export function WorldRegion({ world, controls, onInventory }: Props) {
  const { view } = world;
  const { position, controlsLocked, paused, isLeader, blockType, reason, selectedBlock,
    setSelected, hit, fill, canBuild, recipeId } = controls;
  if (!view?.region || !position) return null;
  return <>
        <Suspense fallback={<div className="world-viewport world-frame world-scene-loading" role="status">Готовим 3D-участок…</div>}><Viewport key={`${view.id}:${view.region.cellId}`} region={view.region} position={position} revision={view.revision} locked={controlsLocked} paused={paused} motion={view.location?.motion ?? null} motionReset={world.motionReset} movementEnabled={controls.movementEnabled}
          targetInfo={`${blockType?.name ?? 'Наведи прицел на объект'} · ${reason || (blockType?.liquid ? 'ПКМ — набрать воду' : 'ЛКМ — бить')}`} targetHp={selectedBlock?.hp ?? null} targetMaxHp={selectedBlock?.maxHp ?? null}
          onSelect={setSelected}
          onHit={hit} onFill={fill} onBuild={p => { if (!controlsLocked && !paused && canBuild) world.act({ type: 'build', position: p, recipeId }); }} onMove={(frames: WorldInputFrame[]) => isLeader && !controlsLocked && !paused ? world.act({ type: 'move', frames }) : false} onInventory={onInventory}/></Suspense>
        <WorldLoadout controls={controls} onInventory={onInventory}/>
        <details className="world-button-controls"><summary>Кнопочное управление</summary><WorldInteraction world={world} controls={controls}/></details>
  </>;
}
