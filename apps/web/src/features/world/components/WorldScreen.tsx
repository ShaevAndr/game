import type { WorldScreenProps } from '../model/world-screen';
import { useWorldControls } from '../model/useWorldControls';
import { WorldLobby } from './WorldLobby';
import { WorldExpedition } from './WorldExpedition';
import { WorldDeliveries } from './WorldDeliveries';

export function WorldScreen(props: WorldScreenProps) {
  const { world, party, onInventory, onCrafting, onGathering } = props;
  const controls = useWorldControls(props);
  const { view } = world;
  return <section className="world-screen main-column" aria-label="Мир экспедиции">
    <header className="world-heading"><div><h2>Общий мир. Твои находки.</h2><p>Отряд идёт за лидером. Каждый собирает собственную добычу.</p></div>
      <div className="world-links"><button className="ghost" onClick={onGathering}>Вылазки</button><button className="ghost" onClick={onCrafting}>Крафт</button><button className="ghost" onClick={onInventory}>Инвентарь</button></div></header>
    {world.error && <div className="world-notice error" role="alert"><span>{world.error}</span><button className="ghost" disabled={world.busy} onClick={world.refresh}>Обновить</button></div>}
    {world.message && <p className="world-message" role="status">{world.message}</p>}
    {world.pending && <div className="world-pending" role="alert"><div><strong>Уточняем результат действия</strong><p>Оно сохранено. Можно безопасно повторить запрос с тем же действием.</p></div><button disabled={world.busy} onClick={world.retry}>{world.busy ? 'Ожидание…' : 'Повторить действие'}</button></div>}
    {view ? <WorldExpedition world={world} controls={controls} party={party} onInventory={onInventory}/>
      : <WorldLobby ready={world.ready} locked={controls.controlsLocked} isLeader={controls.isLeader}
        leaderName={controls.leader?.characterName} onStart={world.start}/>}
    <WorldDeliveries world={world} itemName={controls.itemName}/>
  </section>;
}
