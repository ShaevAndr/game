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
  const { position, controlsLocked, paused, isLeader, blockType, tool, reason, selectedBlock,
    cargoSize, itemName, setSelected, hit, canBuild, recipeId } = controls;
  if (!view?.region || !position) return null;
  return <>
        <Suspense fallback={<div className="world-viewport world-scene-loading" role="status">Готовим 3D-участок…</div>}><Viewport key={`${view.id}:${view.region.cellId}`} region={view.region} position={position} revision={view.revision} locked={controlsLocked} paused={paused} motion={view.location?.motion ?? null} motionReset={world.motionReset} movementEnabled={controls.movementEnabled}
          targetInfo={`${blockType?.name ?? 'Наведи прицел на объект'} · В руке: ${tool?.name ?? 'ничего'} · ${reason || 'ЛКМ — бить'}`} feedback={world.error || world.message} error={!!world.error} targetHp={selectedBlock?.hp ?? null} targetMaxHp={selectedBlock?.maxHp ?? null}
          cargoInfo={`Передача в рюкзак: ${cargoSize} / ${view.cargoCapacity}${view.cargo.length ? ` · ${view.cargo.map(entry => `${itemName(entry.itemId)} ×${entry.quantity}`).join(' · ')}` : ''}. Добытые материалы поступают в общий инвентарь сразу.`} onSelect={setSelected}
          onHit={hit} onBuild={p => { if (!controlsLocked && !paused && canBuild) world.act({ type: 'build', position: p, recipeId }); }} onMove={(frames: WorldInputFrame[]) => isLeader && !controlsLocked && !paused ? world.act({ type: 'move', frames }) : false} onInventory={onInventory}/></Suspense>
        <WorldLoadout controls={controls} onInventory={onInventory}/>
        <WorldInteraction world={world} controls={controls}/>
  </>;
}
