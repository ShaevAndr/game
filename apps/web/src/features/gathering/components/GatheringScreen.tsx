import type { GatheringAction, GatheringLoot, GatheringResource, GatheringView } from '@game/core';

interface Props {
  view: GatheringView | null; busy: boolean; pending: boolean; message: string;
  onAction: (action: GatheringAction) => void; onRefresh: () => void; onRetry: () => void;
  onCrafting: () => void; onInventory: () => void;
}
const typeNames = { plant: 'Растение', tree: 'Дерево', mineral: 'Минерал', crystal: 'Кристалл' };
const typeIcons = { plant: '❧', tree: '♣', mineral: '⛰', crystal: '◇' };

export function GatheringScreen({ view, busy, pending, message, onAction, onRefresh, onRetry, onCrafting, onInventory }: Props) {
  if (!view) return <section className="panel gathering-screen" role="status"><h2>Ресурсные земли</h2><p>Загрузка мира…</p><button disabled={busy} onClick={onRefresh}>Обновить</button></section>;
  const expedition = view.expedition;
  const area = view.areas.find(area => area.id === expedition?.areaId);
  const route = area?.routes.find(route => route.id === expedition?.routeId);
  const locked = busy || pending;
  const lootText = (loot: GatheringLoot) => `${loot.quantity} × ${view.itemNames[loot.itemId] ?? loot.itemId}`;
  const resourceSummary = (resource: GatheringResource) => resource.methods.map(method => lootText(method.output)).join(' / ');
  const cargoSize = expedition?.cargo.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  return <section className="panel gathering-screen">
    <div className="gathering-heading"><div><div className="eyebrow">ИССЛЕДОВАНИЕ И РЕМЕСЛО</div><h2>Ресурсные земли</h2><p>Открывай места, выбирай добычу и возвращайся с материалами.</p></div>
      <div className="gathering-links"><button className="ghost" disabled={busy} onClick={onRefresh}>Обновить</button><button className="ghost" onClick={onCrafting}>Крафт</button><button className="ghost" onClick={onInventory}>Инвентарь</button></div>
    </div>
    <div className="gathering-progress"><strong>Собиратель · уровень {view.level}</strong><span>{view.xp} XP{view.nextLevelXp !== null ? ` · следующий уровень: ${view.nextLevelXp} XP` : ' · максимальный уровень'}</span><span>Атлас: {view.atlas.length} находок</span></div>
    {message && <p className="gathering-message" role="status">{message}</p>}
    {pending && <div className="gathering-pending" role="alert"><p>Результат последнего действия ещё не подтверждён. Повторите запрос, чтобы восстановить его.</p><button disabled={busy} onClick={onRetry}>Повторить действие</button></div>}
    {!expedition ? <div className="gathering-areas">{view.areas.map(area => <article key={area.id} className={`gathering-area gathering-area-${area.id}`}>
      <span className="gathering-area-icon" aria-hidden="true">{area.id === 'forest' ? '♣' : area.id === 'marsh' ? '❧' : '⛰'}</span><h3>{area.name}</h3><p>{area.description}</p>
      {area.routes.map(route => <div key={route.id} className="gathering-route"><h4>{route.name}</h4><p>{route.description}</p><button disabled={locked} onClick={() => onAction({ type: 'start', areaId: area.id, routeId: route.id })}>Отправиться →</button></div>)}
    </article>)}</div> : <>
      <div className="gathering-expedition-heading"><div><h3>{area?.name} · {route?.name}</h3><p>{expedition.step < expedition.totalSteps ? `Остановка ${expedition.step + 1} из ${expedition.totalSteps} · выберите одну находку` : 'Маршрут исследован. Пора возвращаться.'}</p></div>
        <button className="ghost" disabled={locked} onClick={() => onAction({ type: 'return' })}>Вернуться с добычей</button></div>
      <div className="gathering-cargo"><strong>Груз: {cargoSize} / {view.cargoCapacity}</strong><span>{expedition.cargo.length ? expedition.cargo.map(lootText).join(' · ') : 'Пока пусто'}</span><small>Материалы попадут в рюкзак при возвращении. Если он заполнен, груз сохранится.</small></div>
      <div className="gathering-resources">{expedition.resources.map(resource => <article key={resource.id} className="gathering-resource">
        <div className="gathering-resource-type"><span aria-hidden="true">{typeIcons[resource.type]}</span> {typeNames[resource.type]} · уровень {resource.level}</div><h3>{resource.name}</h3><p>{resource.hint}</p>
        {resource.methods.map(method => <div className="gathering-method" key={method.id}><strong>{method.name}</strong><span>{lootText(method.output)}</span>
          {method.bonus && <small>Дополнительно: {lootText(method.bonus)} · {method.bonus.chanceBps / 100}%</small>}
          {method.toolItemId && <small>Инструмент: {view.itemNames[method.toolItemId] ?? method.toolItemId}</small>}
          {method.reason && <small className="gathering-reason">{method.reason}</small>}
          <button disabled={locked || !method.enabled} onClick={() => onAction({ type: 'harvest', resourceId: resource.id, methodId: method.id })}>{method.name}</button>
        </div>)}
      </article>)}</div>
      {expedition.step < expedition.totalSteps && <button className="ghost" disabled={locked} onClick={() => onAction({ type: 'skip' })}>Продолжить без добычи →</button>}
    </>}
    <details className="gathering-atlas"><summary>Личный атлас · {view.atlas.length} находок</summary>
      {!view.atlas.length ? <p>Отправьтесь в первую вылазку, чтобы открыть местные ресурсы.</p> : <div className="gathering-atlas-grid">{view.atlas.map(resource => <article key={resource.id}>
        <strong>{typeIcons[resource.type]} {resource.name}</strong><small>{typeNames[resource.type]} · уровень {resource.level}</small><p>{resource.hint}</p><small>{view.areas.filter(area => area.routes.some(route => route.resourceIds.includes(resource.id))).map(area => area.name).join(', ')}</small><p>{resourceSummary(resource)}</p>
      </article>)}</div>}
    </details>
  </section>;
}
