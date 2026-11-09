import { lazy, Suspense, useEffect, useState } from 'react';
import type { Content, Party, VoxelPosition } from '@game/core';
import type { useWorld } from '../model/useWorld';
import { reachableBlock, sameVoxel, stepTarget, voxelKey, worldTools } from '../model/interaction';
const Viewport = lazy(() => import('./WorldViewport').then(module => ({ default: module.WorldViewport })));
interface Props {
  world: ReturnType<typeof useWorld>; playerId: string; characterId: string; party: Party | null; partyReady: boolean; partyBusy: boolean;
  content: Content | null; onInventory: () => void; onCrafting: () => void; onGathering: () => void;
}
const directions = [{ name: 'На север', icon: '↑', dx: 0, dz: -1, key: 'ArrowUp' }, { name: 'На запад', icon: '←', dx: -1, dz: 0, key: 'ArrowLeft' },
  { name: 'На юг', icon: '↓', dx: 0, dz: 1, key: 'ArrowDown' }, { name: 'На восток', icon: '→', dx: 1, dz: 0, key: 'ArrowRight' }];
export function WorldScreen({ world, playerId, party, partyReady, partyBusy, content, onInventory, onCrafting, onGathering }: Props) {
  const { view } = world, position = view?.location?.position ?? null;
  const [selected, setSelected] = useState<VoxelPosition | null>(null), [toolId, setToolId] = useState(''), [confirmClose, setConfirmClose] = useState(false);
  const tools = worldTools(world.inventory), tool = tools.find(entry => entry.id === toolId) ?? tools.find(entry => !entry.reserved) ?? null;
  const isLeader = (!party || party.leaderPlayerId === playerId) && (!view || view.leaderPlayerId === playerId);
  const controlsLocked = world.busy || world.pending || partyBusy || world.stale || !partyReady || !world.ready;
  const leader = party?.members.find(member => member.playerId === party.leaderPlayerId);
  const itemName = (id: string) => content?.items.find(item => item.id === id)?.name ?? world.inventory?.definitions.find(item => item.id === id)?.name ?? id;
  const selectedBlock = view?.region?.blocks.find(block => sameVoxel(block.position, selected));
  const blockType = view?.region?.palette.find(entry => entry.id === selectedBlock?.blockId);
  const reason = !selectedBlock ? 'Выберите блок в сцене или в списке рядом.' : !position || !reachableBlock(position, selectedBlock.position) ? 'Подойдите ближе к выбранному блоку.'
    : !blockType?.allowedToolClassIds.length ? 'Этот блок нельзя добывать.' : !tool ? 'В основном рюкзаке нужен подходящий инструмент.'
      : tool.reserved ? 'Инструмент занят предыдущим действием.' : !blockType.allowedToolClassIds.includes(tool.toolClassId) ? 'Выберите подходящий инструмент.' : '';
  const near = view?.region?.blocks.filter(block => position && reachableBlock(position, block.position)) ?? [];
  const cargoSize = view?.cargo.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
  useEffect(() => { setSelected(null); setConfirmClose(false); }, [view?.id, view?.region?.cellId]);
  useEffect(() => { if (selected && !selectedBlock) setSelected(null); }, [selected, selectedBlock]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target.closest('input,select,textarea,button,[contenteditable="true"],[role="dialog"]')) return;
      const direction = directions.find(entry => entry.key === event.key);
      if (!direction || !view?.region || !isLeader || controlsLocked) return;
      const targetPosition = stepTarget(view, direction.dx, direction.dz);
      event.preventDefault(); if (targetPosition) world.act({ type: 'move', position: targetPosition });
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [view, isLeader, controlsLocked, world.act]);

  return <section className="world-screen main-column" aria-label="Мир экспедиции">
    <header className="world-heading"><div><div className="eyebrow">ЗА ГРАНИЦЕЙ ТРОП</div><h2>Общий мир. Твои находки.</h2><p>Отряд идёт за лидером. Каждый собирает собственную добычу.</p></div>
      <div className="world-links"><button className="ghost" onClick={onGathering}>Вылазки</button><button className="ghost" onClick={onCrafting}>Крафт</button><button className="ghost" onClick={onInventory}>Инвентарь</button></div></header>
    {world.error && <div className="world-notice error" role="alert"><span>{world.error}</span><button className="ghost" disabled={world.busy} onClick={world.refresh}>Обновить</button></div>}
    {world.message && <p className="world-message" role="status">{world.message}</p>}
    {world.pending && <div className="world-pending" role="alert"><div><strong>Уточняем результат действия</strong><p>Оно сохранено. Можно безопасно повторить запрос с тем же действием.</p></div><button disabled={world.busy} onClick={world.retry}>{world.busy ? 'Ожидание…' : 'Повторить действие'}</button></div>}
    {!view ? <article className="panel world-lobby"><div className="world-compass" aria-hidden="true">✧</div><div className="eyebrow">ИССЛЕДУЙ. ИЗМЕНЯЙ. СОБИРАЙ.</div>
      <h3>Что скрывается за следующим холмом?</h3><p>Открой карту, выбери участок и спустись за ресурсами. Срубленные деревья и прорытые ходы останутся до конца экспедиции.</p>
      <div className="world-lobby-facts"><span><b>Один мир</b>для всей группы</span><span><b>Личный груз</b>для твоего героя</span><span><b>Без спешки</b>прогресс сохраняется</span></div>
      <button className="primary" disabled={controlsLocked || !isLeader} onClick={world.start}>{!world.ready ? 'Подключение к миру…' : isLeader ? 'Начать экспедицию →' : 'Ожидаем лидера'}</button>
      <small>{!isLeader ? `${leader?.characterName ?? 'Лидер'} может начать экспедицию.` : 'Отправляйся один или пригласи друзей в группу.'}</small>
    </article> : <>
      <div className="world-expedition-bar"><span className="world-live"><i className={world.stale ? 'stale' : ''}/>{world.stale ? 'Ожидаем обновления' : 'Отряд в экспедиции'}</span><span>{party?.members.length ?? view.members.length} в отряде · {isLeader ? 'Ты ведёшь группу' : `Ведёт ${leader?.characterName ?? 'лидер'}`}</span>
        <button className="ghost" disabled={world.busy} onClick={world.refresh}>Обновить</button></div>
      {view.region && position ? <>
        <Suspense fallback={<div className="world-viewport world-scene-loading" role="status">Готовим 3D-участок…</div>}><Viewport key={`${view.id}:${view.region.cellId}`} region={view.region} position={position} selected={selected} onSelect={setSelected}/></Suspense>
        <div className="world-interaction">
          <article className="panel world-target"><div className="section-label">ДОБЫЧА</div><h3>{blockType?.name ?? 'Выбери свою находку'}</h3>
            <p>{selectedBlock ? `Блок ${selectedBlock.position.x}, ${selectedBlock.position.y}, ${selectedBlock.position.z}` : 'Нажми на блок в 3D-сцене. Добывать можно рядом с отрядом.'}</p>
            <label>Инструмент<select aria-label="Инструмент для добычи" value={tool?.id ?? ''} disabled={world.busy || world.pending} onChange={event => setToolId(event.target.value)}>
              {!tools.length && <option value="">Нет инструментов в рюкзаке</option>}{tools.map((entry, index) => <option value={entry.id} key={entry.id}>{entry.name}{tools.filter(candidate => candidate.name === entry.name).length > 1 ? ` · ${index + 1}` : ''}{entry.reserved ? ' (занят)' : ''}</option>)}</select></label>
            {world.inventoryError && <p role="alert">{world.inventoryError}</p>}
            {!tools.length && <p className="hint">Создай инструмент в крафте и положи в основной рюкзак.</p>}
            <p className="world-action-reason" aria-live="polite">{reason || 'Инструмент подходит. Можно добывать.'}</p>
            <button className="primary" disabled={controlsLocked || !!reason} onClick={() => { if (selectedBlock && tool) world.act({ type: 'harvest', position: selectedBlock.position, toolInstanceId: tool.id }); }}>Добыть блок</button>
            <details className="world-nearby"><summary>Блоки рядом · {near.length}</summary><div>{near.map(block => <button className={sameVoxel(block.position, selected) ? 'chosen' : ''} key={voxelKey(block.position)} onClick={() => setSelected(block.position)} aria-pressed={sameVoxel(block.position, selected)}>
              {view.region!.palette.find(entry => entry.id === block.blockId)?.name ?? block.blockId}<small>{block.position.x}, {block.position.y}, {block.position.z}</small></button>)}</div></details>
          </article>
          <article className="panel world-movement"><div className="section-label">ПЕРЕМЕЩЕНИЕ ОТРЯДА</div><h3>{isLeader ? 'Выбирай направление' : 'Следуем за лидером'}</h3><p>{isLeader ? 'Кнопки или стрелки на клавиатуре. Север — верх карты.' : 'Позиция общая для всех. Осматривайся и добывай рядом.'}</p>
            <div className="world-dpad">{directions.map(direction => { const target = stepTarget(view, direction.dx, direction.dz);
              return <button key={direction.key} className={`world-step world-step-${direction.key}`} aria-label={direction.name} title={target ? direction.name : 'Нет видимой опоры для шага'} disabled={!isLeader || controlsLocked || !target} onClick={() => { if (target) world.act({ type: 'move', position: target }); }}>{direction.icon}</button>;
            })}<span>С</span></div><div className="world-position">Позиция <b>{position.x} · {position.y} · {position.z}</b></div>
            <button className="ghost" disabled={!isLeader || controlsLocked} onClick={() => world.act({ type: 'leave' })}>← Вернуться на карту</button>
          </article>
        </div>
      </> : null}
      <details className="panel world-map-panel" open={!view.region}><summary><span>Карта экспедиции</span><small>{view.region ? 'Покинь участок, чтобы выбрать путь' : 'Выбирай соседние клетки'}</small></summary>
        <div className="world-map" role="group" aria-label="Карта экспедиции" style={{ gridTemplateColumns: `repeat(${Math.max(...view.map.map(cell => cell.x)) + 1}, minmax(0, 1fr))` }}>{[...view.map].sort((a, b) => a.z - b.z || a.x - b.x).map(cell => {
          const current = view.location?.cellId === cell.id, origin = view.map.find(entry => entry.id === view.location?.cellId);
          const adjacent = !!origin && Math.abs(origin.x - cell.x) + Math.abs(origin.z - cell.z) === 1;
          const name = view.biomes.find(biome => biome.id === cell.biomeId)?.name ?? cell.biomeId;
          return <button key={cell.id} className={`world-map-cell${current ? ' current' : ''}`} aria-label={`${name}, ${cell.x + 1}:${cell.z + 1}${current ? ', отряд здесь' : ''}`} aria-current={current ? 'location' : undefined} disabled={controlsLocked || !isLeader || !!view.region || !current && !adjacent}
            onClick={() => world.act(current ? { type: 'enter' } : { type: 'travel', cellId: cell.id })}><span aria-hidden="true">{current ? '⚑' : '♣'}</span><strong>{name}</strong><small>{current ? 'Войти в участок →' : `${cell.x + 1} : ${cell.z + 1}`}</small></button>;
        })}</div>
        {!isLeader && <p className="hint">Отряд перемещает лидер. Ты войдёшь в участок вместе с ним.</p>}
      </details>
      <article className="panel world-cargo"><div className="section-heading"><div><div className="section-label">ЛИЧНЫЙ ГРУЗ</div><h3>{cargoSize} <span>/ {view.cargoCapacity}</span></h3></div><span>{view.xp} XP добычи</span></div>
        <div className="world-materials">{view.cargo.length ? view.cargo.map(entry => <span key={entry.itemId}>{itemName(entry.itemId)} <b>×{entry.quantity}</b></span>) : <p>Пока пусто. Выбери инструмент и добудь первый блок.</p>}</div>
        <p>При завершении экспедиции материалы отправятся в рюкзак. Если места не хватит, их можно получить позже.</p>
      </article>
      <div className="world-close">{confirmClose ? <div className="world-close-confirm" role="group" aria-label="Завершение экспедиции"><p>Завершить для всей группы? Добыча сохранится, участки будут закрыты.</p><button disabled={!isLeader || controlsLocked} onClick={() => { setConfirmClose(false); world.act({ type: 'close' }); }}>Завершить и забрать груз</button><button className="ghost" onClick={() => setConfirmClose(false)}>Продолжить поход</button></div>
        : <button className="ghost" disabled={!isLeader || controlsLocked} onClick={() => setConfirmClose(true)}>Завершить экспедицию</button>}</div>
    </>}
    <article className="panel world-deliveries"><div className="section-heading"><div><div className="section-label">ПОСЛЕ ПОХОДА</div><h3>Добыча из экспедиций</h3></div><button className="ghost" onClick={world.refresh} disabled={world.busy}>Обновить</button></div>
      {world.cargoError && <p className="world-action-reason" role="alert">{world.cargoError}</p>}
      {!world.cargo.length ? <p>Здесь появится запечатанный груз после похода или выхода из группы.</p> : <div className="world-documents">{world.cargo.map(document => <div className="world-document" key={document.id}><div><strong>{document.cargo.map(entry => `${itemName(entry.itemId)} ×${entry.quantity}`).join(' · ')}</strong>
        <small>{document.status === 'imported' ? 'В рюкзаке' : document.status === 'available' ? document.reason ?? 'Освободи место в рюкзаке' : 'Ожидает получения'}</small></div>
        {document.status === 'imported' ? <span className="world-received">Получено ✓</span> : <button disabled={world.busy || world.pending} onClick={() => world.claim(document.id)}>Получить</button>}</div>)}</div>}
    </article>
  </section>;
}
