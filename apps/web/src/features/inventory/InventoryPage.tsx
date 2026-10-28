import { useState } from 'react';
import { Character } from '@game/core';
import { useInventory } from './model/useInventory';
import { InventoryScreen } from './components/InventoryScreen';
import './inventory.css';

interface Props { ownerId: string; characters: Character[]; busy: boolean; onError: (message: string) => void; run: (task: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void> }
export function InventoryPage({ ownerId, characters, busy, onError, run, onChanged }: Props) {
  const [recipientId, setRecipientId] = useState(ownerId);
  const current = useInventory(ownerId, onError);
  const target = useInventory(recipientId === ownerId ? '' : recipientId, onError);
  if (!ownerId) return <section className="panel"><h2>Инвентарь</h2><p>Выберите персонажа.</p></section>;
  if (!current.view) return <section className="panel" role="status">Загрузка инвентарей…</section>;
  return <InventoryScreen view={current.view} characters={characters} recipientId={recipientId} onRecipient={setRecipientId}
    destinations={recipientId === ownerId ? current.view.inventories : target.view?.inventories ?? []} busy={busy}
    onExecute={command => void run(() => current.execute(command, async () => { await target.refresh(); await onChanged(); }))}
    onRefresh={() => void run(async () => { await current.refresh(); await target.refresh(); await onChanged(); })}/>;
}
