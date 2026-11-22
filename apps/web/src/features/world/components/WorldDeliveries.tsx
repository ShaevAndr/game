import type { useWorld } from '../model/useWorld';

interface Props {
  world: ReturnType<typeof useWorld>;
  itemName: (id: string) => string;
}

export function WorldDeliveries({ world, itemName }: Props) {
  if (!world.cargo.length && !world.cargoError) return null;
  return <article className="panel world-deliveries"><div className="section-heading"><div><h3>Добыча из экспедиций</h3></div><button className="ghost" onClick={world.refresh} disabled={world.busy}>Обновить</button></div>
      {world.cargoError && <p className="world-action-reason" role="alert">{world.cargoError}</p>}
      <div className="world-documents">{world.cargo.map(document => <div className="world-document" key={document.id}><div><strong>{document.cargo.map(entry => `${itemName(entry.itemId)} ×${entry.quantity}`).join(' · ')}</strong>
        {document.status !== 'imported' && <small>{document.status === 'available' ? document.reason ?? 'Освободи место в рюкзаке' : 'Ожидает получения'}</small>}</div>
        {document.status === 'imported' ? <span className="world-received">Получено ✓</span> : <button disabled={world.busy || world.pending} onClick={() => world.claim(document.id)}>Получить</button>}</div>)}</div>
    </article>;
}
