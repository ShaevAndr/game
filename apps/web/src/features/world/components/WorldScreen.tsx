import { lazy, Suspense, useEffect, useState } from 'react';
import { worldBuildingRecipes, type Content, type Party, type VoxelPosition, type WorldInputFrame } from '@game/core';
import { Modal } from '../../../shared/ui/Modal';
import type { useWorld } from '../model/useWorld';
import { reachableBlock, sameVoxel, directionFrames, voxelKey, worldTools } from '../model/interaction';
const Viewport = lazy(() => import('./WorldViewport').then(module => ({ default: module.WorldViewport })));
interface Props {
  world: ReturnType<typeof useWorld>; playerId: string; characterId: string; party: Party | null; partyReady: boolean; partyBusy: boolean; inventoryOpen: boolean;
  content: Content | null; onInventory: () => void; onCrafting: () => void; onGathering: () => void;
}
const directions = [{ name: 'На север', icon: '↑', dx: 0, dz: -1, key: 'ArrowUp' }, { name: 'На запад', icon: '←', dx: -1, dz: 0, key: 'ArrowLeft' },
  { name: 'На юг', icon: '↓', dx: 0, dz: 1, key: 'ArrowDown' }, { name: 'На восток', icon: '→', dx: 1, dz: 0, key: 'ArrowRight' }];
export function WorldScreen({ world, playerId, party, partyReady, partyBusy, inventoryOpen, content, onInventory, onCrafting, onGathering }: Props) {
  const { view } = world, position = view?.location?.position ?? null;
  const [selected, setSelected] = useState<VoxelPosition | null>(null), [toolId, setToolId] = useState<string | null>(null), [confirmClose, setConfirmClose] = useState(false);
  const [menu, setMenu] = useState<'tools' | 'buildings' | null>(null), [recipeId, setRecipeId] = useState(worldBuildingRecipes[0].id);
  const isLeader = (!party || party.leaderPlayerId === playerId) && (!view || view.leaderPlayerId === playerId);
  const controlsLocked = world.busy || world.pending || partyBusy || world.stale || !partyReady || !world.ready;
  const leader = party?.members.find(member => member.playerId === party.leaderPlayerId);
  const itemName = (id: string) => content?.items.find(item => item.id === id)?.name ?? world.inventory?.definitions.find(item => item.id === id)?.name ?? id;
  const selectedBlock = view?.region?.blocks.find(block => sameVoxel(block.position, selected));
  const blockType = view?.region?.palette.find(entry => entry.id === selectedBlock?.blockId);
  const allTools = worldTools(world.inventory), tools = worldTools(world.inventory, blockType?.allowedToolClassIds);
  const tool = allTools.find(entry => entry.id === toolId) ?? null;
  useEffect(() => { if (toolId === null && allTools.length) setToolId(allTools.find(entry => !entry.reserved)?.id ?? allTools[0].id); }, [world.inventory, toolId]);
  const recipe = worldBuildingRecipes.find(entry => entry.id === recipeId)!;
  const primary = world.inventory?.inventories.find(bag => bag.primary);
  const amount = (itemId: string) => world.inventory?.items.filter(item => item.itemId === itemId && item.inventoryId === primary?.id && !item.equippedSlot && !item.actions.some(action => action.reason === 'Инструмент используется командой мира')).reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const canBuild = recipe.ingredients.every(cost => amount(cost.itemId) >= cost.quantity);
  const paused = inventoryOpen || menu !== null;
  const hit = (p: VoxelPosition) => {
    if (controlsLocked || paused || !position || !reachableBlock(position, p, view?.region?.blockSizeMeters)) return;
    const block = view?.region?.blocks.find(entry => sameVoxel(entry.position, p));
    const allowed = view?.region?.palette.find(entry => entry.id === block?.blockId)?.allowedToolClassIds ?? [];
    if (tool && !tool.reserved && allowed.includes(tool.toolClassId)) world.act({ type: 'harvest', position: p, toolInstanceId: tool.id });
  };
  const move = (dx: number, dz: number, jump = false) => { if (view && isLeader && !controlsLocked && !paused) return world.act({ type: 'move', frames: directionFrames(view, dx, dz, jump) }); return false; };
  const reason = !selectedBlock ? 'Выберите блок в сцене или в списке рядом.' : !position || !reachableBlock(position, selectedBlock.position, view?.region?.blockSizeMeters) ? 'Подойдите ближе к выбранному блоку.'
    : !blockType?.allowedToolClassIds.length ? 'Этот блок нельзя добывать.' : !tool ? 'В основном рюкзаке нужен подходящий инструмент.'
      : tool.reserved ? 'Инструмент занят предыдущим действием.' : !blockType.allowedToolClassIds.includes(tool.toolClassId) ? 'Выберите подходящий инструмент.' : '';
  const near = view?.region?.blocks.filter(block => position && reachableBlock(position, block.position, view?.region?.blockSizeMeters)) ?? [];
  const cargoSize = view?.cargo.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
  useEffect(() => { setSelected(null); setConfirmClose(false); }, [view?.id, view?.region?.cellId]);
  useEffect(() => { if (selected && !selectedBlock) setSelected(null); }, [selected, selectedBlock]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target.closest('input,select,textarea,button,[contenteditable="true"],[role="dialog"],dialog')) return;
      if (event.code === 'KeyI' && !paused) { event.preventDefault(); onInventory(); return; }
      if (paused) return;
      const direction = directions.find(entry => entry.key === event.key);
      if (!direction || !view?.region || !isLeader || controlsLocked) return;
      event.preventDefault(); move(direction.dx, direction.dz);
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [view, isLeader, controlsLocked, paused, onInventory, world.act]);

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
        <Suspense fallback={<div className="world-viewport world-scene-loading" role="status">Готовим 3D-участок…</div>}><Viewport key={`${view.id}:${view.region.cellId}`} region={view.region} position={position} revision={view.revision} locked={controlsLocked} paused={paused} motion={view.location?.motion ?? null} motionReset={world.motionReset} movementEnabled={isLeader && !partyBusy && partyReady && world.ready && !world.stale && !world.pending && (!world.busy || world.moving)}
          targetInfo={`${blockType?.name ?? 'Наведи прицел на объект'} · В руке: ${tool?.name ?? 'ничего'} · ${reason || 'ЛКМ — бить'}`} feedback={world.error || world.message} error={!!world.error} targetHp={selectedBlock?.hp ?? null} targetMaxHp={selectedBlock?.maxHp ?? null}
          cargoInfo={`Передача в рюкзак: ${cargoSize} / ${view.cargoCapacity}${view.cargo.length ? ` · ${view.cargo.map(entry => `${itemName(entry.itemId)} ×${entry.quantity}`).join(' · ')}` : ''}. Добытые материалы поступают в общий инвентарь сразу.`} onSelect={setSelected}
          onHit={hit} onBuild={p => { if (!controlsLocked && !paused && canBuild) world.act({ type: 'build', position: p, recipeId }); }} onMove={(frames: WorldInputFrame[]) => isLeader && !controlsLocked && !paused ? world.act({ type: 'move', frames }) : false} onInventory={onInventory}/></Suspense>
        <div className="world-hotbar" aria-label="Действия мыши">
          <div><strong><span>ЛКМ</span> Бить</strong><button className="ghost" onClick={() => setMenu('tools')} aria-label="Выбрать инструмент">{tool?.name ?? 'Выбрать инструмент'} <span>⌄</span></button></div>
          <div><strong><span>ПКМ</span> Строить</strong><button className="ghost" onClick={() => setMenu('buildings')} aria-label="Выбрать строение">{recipe.name} <span>⌄</span></button></div>
          <button className="ghost" onClick={onInventory}>Инвентарь · I</button>
        </div>
        {menu === 'tools' && <Modal title="Выбор инструмента" onClose={() => setMenu(null)}><p className="hint">{blockType ? `Для объекта «${blockType.name}»` : 'Инструменты из основного рюкзака. Наведи прицел на объект, чтобы отфильтровать подходящие.'}</p>
          <div className="world-tool-list">{tools.length ? tools.map(entry => <button key={entry.id} disabled={entry.reserved} aria-pressed={tool?.id === entry.id} onClick={() => { setToolId(entry.id); setMenu(null); }}>{entry.name}{entry.reserved ? ' · занят' : tool?.id === entry.id ? ' ✓' : ''}</button>) : <p>В рюкзаке нет допустимого инструмента для этого объекта.</p>}</div></Modal>}
        {menu === 'buildings' && <Modal title="Выбор строения" onClose={() => setMenu(null)}><p className="hint">Материалы из основного рюкзака спишутся после установки через ПКМ.</p><div className="world-building-list">{worldBuildingRecipes.map(entry => <article className="panel" key={entry.id}><h3>{entry.name}</h3>{entry.ingredients.map(cost => <p key={cost.itemId} className={amount(cost.itemId) < cost.quantity ? 'missing' : ''}>{itemName(cost.itemId)}: {amount(cost.itemId)} / {cost.quantity}</p>)}<button aria-pressed={recipeId === entry.id} onClick={() => { setRecipeId(entry.id); setMenu(null); }}>{recipeId === entry.id ? 'Выбрано ✓' : 'Выбрать'}</button></article>)}</div></Modal>}
        {!canBuild && <p className="hint">Для «{recipe.name}» нужны материалы. Открой выбор строения, чтобы увидеть стоимость.</p>}
        <div className="world-interaction">
          <article className="panel world-target"><div className="section-label">ДОБЫЧА</div><h3>{blockType?.name ?? 'Выбери свою находку'}</h3>{selectedBlock?.maxHp && <p>HP {selectedBlock.hp} / {selectedBlock.maxHp}</p>}
            <p>{selectedBlock ? `Блок ${selectedBlock.position.x}, ${selectedBlock.position.y}, ${selectedBlock.position.z}` : 'Нажми на блок в 3D-сцене. Добывать можно рядом с отрядом.'}</p>
            {world.inventoryError && <p role="alert">{world.inventoryError}</p>}
            <p className="world-action-reason" aria-live="polite">{reason || 'Инструмент подходит. Можно добывать.'}</p>
            <button className="primary" disabled={controlsLocked || paused || !!reason} onClick={() => { if (selectedBlock) hit(selectedBlock.position); }}>Бить</button>
            <details className="world-nearby"><summary>Блоки рядом · {near.length}</summary><div>{near.map(block => <button className={sameVoxel(block.position, selected) ? 'chosen' : ''} key={voxelKey(block.position)} onClick={() => setSelected(block.position)} aria-pressed={sameVoxel(block.position, selected)}>
              {view.region!.palette.find(entry => entry.id === block.blockId)?.name ?? block.blockId}<small>{block.position.x}, {block.position.y}, {block.position.z}</small></button>)}</div></details>
          </article>
          <article className="panel world-movement"><div className="section-label">ПЕРЕМЕЩЕНИЕ ОТРЯДА</div><h3>{isLeader ? 'Выбирай направление' : 'Следуем за лидером'}</h3><p>{isLeader ? 'WASD — движение в любом направлении. Можно управлять и в прыжке.' : 'Позиция общая для всех. Осматривайся и добывай рядом.'}</p>
            <div className="world-dpad">{directions.map(direction => { 
              return <button key={direction.key} className={`world-step world-step-${direction.key}`} aria-label={direction.name} title={direction.name} disabled={!isLeader || controlsLocked} onClick={() => move(direction.dx, direction.dz)}>{direction.icon}</button>;
            })}<span>С</span></div><div className="world-position">Позиция <b>{(position.x * view.region.blockSizeMeters).toFixed(2)} · {(position.y * view.region.blockSizeMeters).toFixed(2)} · {(position.z * view.region.blockSizeMeters).toFixed(2)} м</b></div>
            <button className="ghost" disabled={!isLeader || controlsLocked} onClick={() => move(0, 0, true)}>Прыгнуть</button>
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
      <article className="panel world-cargo"><div className="section-heading"><div><div className="section-label">ПЕРЕДАЧА ДОБЫЧИ В РЮКЗАК</div><h3>{cargoSize} <span>/ {view.cargoCapacity}</span></h3></div><span>{view.xp} XP добычи</span></div>
        <div className="world-materials">{view.cargo.length ? view.cargo.map(entry => <span key={entry.itemId}>{itemName(entry.itemId)} <b>×{entry.quantity}</b></span>) : <p>Нет ожидающей передачи добычи.</p>}</div>
        <p>Материалы поступают в общий инвентарь сразу после добычи. Если места не хватит, освободи ячейки и нажми «Получить» ниже.</p>
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
