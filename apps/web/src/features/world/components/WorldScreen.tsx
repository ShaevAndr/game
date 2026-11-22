import { useState } from 'react';
import type { WorldScreenProps } from '../model/world-screen';
import { useWorldControls } from '../model/useWorldControls';
import { WorldHelp } from './WorldHelp';
import { WorldLobby } from './WorldLobby';
import { WorldExpedition } from './WorldExpedition';
import { WorldDeliveries } from './WorldDeliveries';

export function WorldScreen(props: WorldScreenProps) {
  const { world, party, onInventory, onCrafting, onGathering } = props;
  const [helpOpen, setHelpOpen] = useState(false);
  const controls = useWorldControls(props, helpOpen);
  const { view } = world;
  const problem = world.error || world.inventoryError;
  return <section className="world-screen main-column" aria-label="Мир экспедиции">
    <header className="world-heading"><h2>Исследование мира</h2>
      <div className="world-links"><button className="ghost" onClick={() => setHelpOpen(true)} aria-haspopup="dialog">Помощь</button><button className="ghost" onClick={onGathering}>Вылазки</button><button className="ghost" onClick={onCrafting}>Крафт</button><button className="ghost" onClick={onInventory}>Инвентарь</button></div>
      <div className="world-status-layer">
        {world.pending ? <div className="world-pending" role="alert"><div><strong>Уточняем результат действия</strong><p>{problem || 'Действие сохранено. Можно безопасно повторить запрос.'}</p></div><button disabled={world.busy} onClick={world.retry}>Повторить действие</button></div>
          : problem && <div className="world-notice error" role="alert"><span>{problem}</span><button className="ghost" disabled={world.busy} onClick={world.refresh}>Обновить</button></div>}
      </div>
    </header>
    {helpOpen && <WorldHelp onClose={() => setHelpOpen(false)}/>}
    {view ? <WorldExpedition world={world} controls={controls} party={party} onInventory={onInventory}/>
      : <WorldLobby ready={world.ready} locked={controls.controlsLocked} isLeader={controls.isLeader}
        leaderName={controls.leader?.characterName} onStart={world.start}/>}
    <WorldDeliveries world={world} itemName={controls.itemName}/>
  </section>;
}
