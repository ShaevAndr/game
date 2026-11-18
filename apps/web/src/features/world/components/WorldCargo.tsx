import type { WorldExpeditionView } from '@game/core';

interface Props {
  view: WorldExpeditionView;
  cargoSize: number;
  itemName: (id: string) => string;
}

export function WorldCargo({ view, cargoSize, itemName }: Props) {
  return <article className="panel world-cargo"><div className="section-heading"><div><div className="section-label">ПЕРЕДАЧА ДОБЫЧИ В РЮКЗАК</div><h3>{cargoSize} <span>/ {view.cargoCapacity}</span></h3></div><span>{view.xp} XP добычи</span></div>
        <div className="world-materials">{view.cargo.length ? view.cargo.map(entry => <span key={entry.itemId}>{itemName(entry.itemId)} <b>×{entry.quantity}</b></span>) : <p>Нет ожидающей передачи добычи.</p>}</div>
        <p>Материалы поступают в общий инвентарь сразу после добычи. Если места не хватит, освободи ячейки и нажми «Получить» ниже.</p>
      </article>;
}
