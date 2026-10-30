import { Character } from '@game/core';
import { useEffect } from 'react';
import { useInventory } from '../inventory/model/useInventory';
import { EquipmentScreen } from './components/EquipmentScreen';
import '../inventory/inventory.css';
import './equipment.css';
import { charactersApi } from '../characters/api/characters.api';

interface Props {
  ownerId: string; character?: Character; busy: boolean; onError: (message: string) => void;
  run: (task: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>; onInventory: () => void;
}

export function EquipmentPage({ ownerId, character, busy, onError, run, onChanged, onInventory }: Props) {
  const inventory = useInventory(ownerId, onError);
  useEffect(() => {
    if (ownerId) void onChanged().catch(error => onError(error.message));
  }, [ownerId, onChanged, onError]);
  if (!ownerId) return <section className="panel"><h2>Экипировка</h2><p>Выберите персонажа.</p></section>;
  if (!inventory.view) return <section className="panel" role="status">Загрузка экипировки…</section>;
  return <EquipmentScreen view={inventory.view} character={character} busy={busy} onInventory={onInventory}
    onAllocate={(allocations, expectedRevision) => void run(async () => { await charactersApi.allocate(ownerId, allocations, expectedRevision); await onChanged(); await inventory.refresh(); })}
    onExecute={command => void run(() => inventory.execute(command, onChanged))}
    onRefresh={() => void run(async () => { await inventory.refresh(); await onChanged(); })}/>;
}
