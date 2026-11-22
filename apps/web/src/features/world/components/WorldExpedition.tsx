import { useEffect, useState } from 'react';
import type { Party } from '@game/core';
import type { useWorld } from '../model/useWorld';
import type { useWorldControls } from '../model/useWorldControls';
import { WorldRegion } from './WorldRegion';
import { WorldMap } from './WorldMap';

interface Props {
  world: ReturnType<typeof useWorld>;
  controls: ReturnType<typeof useWorldControls>;
  party: Party | null;
  onInventory: () => void;
}

export function WorldExpedition({ world, controls, party, onInventory }: Props) {
  const { view } = world;
  const { isLeader, leader, controlsLocked } = controls;
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => { setConfirmClose(false); }, [view?.id, view?.region?.cellId]);
  if (!view) return null;
  return <>
      <div className="world-expedition-bar"><span className="world-live"><i className={world.stale ? 'stale' : ''}/>{world.stale ? 'Ожидаем обновления' : 'Отряд в экспедиции'}</span><span>{party?.members.length ?? view.members.length} в отряде · {isLeader ? 'Ты ведёшь группу' : `Ведёт ${leader?.characterName ?? 'лидер'}`}</span>
        <span className="world-xp">{view.xp} XP добычи</span><button className="ghost" disabled={world.busy} onClick={world.refresh}>Обновить</button></div>
    <WorldRegion world={world} controls={controls} onInventory={onInventory}/>
    <WorldMap view={view} controlsLocked={controlsLocked} isLeader={isLeader} onAction={world.act}/>
      <div className="world-close">{confirmClose ? <div className="world-close-confirm" role="group" aria-label="Завершение экспедиции"><p>Завершить для всей группы? Добыча сохранится, участки будут закрыты.</p><button disabled={!isLeader || controlsLocked} onClick={() => { setConfirmClose(false); world.act({ type: 'close' }); }}>Завершить и забрать груз</button><button className="ghost" onClick={() => setConfirmClose(false)}>Продолжить поход</button></div>
        : <button className="ghost" disabled={!isLeader || controlsLocked} onClick={() => setConfirmClose(true)}>Завершить экспедицию</button>}</div>
  </>;
}
