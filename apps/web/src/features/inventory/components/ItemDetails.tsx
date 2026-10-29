import { useState } from 'react';
import { Character, InventoryCommand, InventoryContainer, InventoryView } from '@game/core';
import { ItemIcon } from './ItemIcon';
import { slotNames, statNames } from './EquipmentPanel';

type Command = Exclude<InventoryCommand, { type: 'receive' }>;
interface Props {
  view: InventoryView; selectedId: string; characters: Character[]; busy: boolean;
  recipientId: string; destinations: InventoryContainer[];
  onRecipient: (id: string) => void; onExecute: (command: Command) => void;
}
export function ItemDetails({ view, selectedId, characters, busy, recipientId, destinations, onRecipient, onExecute }: Props) {
  const [amount, setAmount] = useState(1);
  const selected = view.items.find(item => item.id === selectedId);
  if (!selected) return <aside className="item-details empty-item-details"><span aria-hidden="true">◇</span><div><h3>Выберите предмет</h3><p>Нажмите на ячейку рюкзака или на надетую вещь, чтобы увидеть свойства и действия.</p></div></aside>;
  const definition = view.definitions.find(item => item.id === selected.itemId);
  const primary = view.inventories.find(inventory => inventory.primary);
  const can = (action: string) => selected.actions.some(value => value.id === action && value.enabled);
  const equipped = !!selected.equippedSlot;
  const inBackpack = selected.inventoryId === primary?.id;
  const previous = definition?.equipSlot ? view.items.find(item => item.equippedSlot === definition.equipSlot && item.id !== selected.id) : undefined;
  const previousDefinition = view.definitions.find(item => item.id === previous?.itemId);
  const compatible = view.items.find(item => item.id !== selected.id && item.itemId === selected.itemId && item.inventoryId === selected.inventoryId && !item.equippedSlot && item.quantity + selected.quantity <= (definition?.stackLimit ?? 0));
  const quantityValid = Number.isInteger(amount) && amount > 0 && amount <= selected.quantity;
  const destination = destinations.find(inventory => inventory.primary);
  const unequipAction = selected.actions.find(action => action.id === 'unequip');

  return <aside className="item-details" aria-label="Свойства предмета">
    <div className="item-description">
      <div className="item-title"><span className="item-large-icon"><ItemIcon item={definition}/></span><div><span className="item-category">{definition?.equipSlot ? slotNames[definition.equipSlot] ?? definition.equipSlot : view.groups.find(group => group.id === definition?.groupId)?.name}</span><h3>{definition?.name ?? selected.itemId}</h3><span className={`item-location ${equipped ? 'is-equipped' : ''}`}>{equipped ? '● Надето на персонажа' : inBackpack ? 'В рюкзаке' : 'В сохранённых предметах'}{selected.quantity > 1 ? ` · ${selected.quantity} шт.` : ''}</span></div></div>
      <p>{definition?.description ?? 'Описание предмета недоступно.'}</p>
      {!!definition?.bonuses && <dl className="item-bonuses">{Object.entries(definition.bonuses).map(([key, value]) => <div key={key}><dt>{statNames[key] ?? key}</dt><dd>+{value}</dd></div>)}</dl>}
      {previous && !equipped && <p className="replacement-note">При надевании «{previousDefinition?.name ?? previous.itemId}» вернётся в рюкзак.</p>}
      {selected.actions.some(action => action.id === 'use-in-battle') && <p className="hint">Используется во время боя.</p>}
      {equipped && !unequipAction?.enabled && <p className="inventory-notice" role="status">{unequipAction?.reason ?? 'Снять предмет сейчас нельзя.'}</p>}
    </div>
    <div className="item-controls">
      <div className="item-actions">
        {equipped ? <button className="primary" disabled={busy || !can('unequip')} onClick={() => onExecute({ type: 'unequip', instanceId: selected.id })}>Снять в рюкзак</button>
          : !inBackpack && primary ? <button className="primary" disabled={busy || !can(selected.inventoryId ? 'transfer' : 'put')} onClick={() => onExecute({ type: selected.inventoryId ? 'transfer' : 'put', instanceId: selected.id, targetInventoryId: primary.id, quantity: selected.quantity })}>Вернуть в рюкзак</button>
          : <>{selected.actions.some(action => action.id === 'equip') && <button className="primary" disabled={busy || !can('equip')} onClick={() => onExecute({ type: 'equip', instanceId: selected.id })}>{previous ? 'Заменить надетое' : 'Надеть'}</button>}
            {selected.actions.some(action => action.id === 'read') && <button className="primary" disabled={busy || !can('read')} title={selected.actions.find(action => action.id === 'read')?.reason} onClick={() => onExecute({ type: 'read', instanceId: selected.id })}>Прочитать свиток</button>}</>}
      </div>
      {!equipped && <>
        {selected.quantity > 1 && <div className="stack-controls"><label>Количество<input aria-label="Количество предметов" type="number" min={1} max={selected.quantity} value={amount} onChange={event => setAmount(Number(event.target.value))}/></label>
          {selected.actions.some(action => action.id === 'split') && <button className="ghost" disabled={busy || !quantityValid || amount === selected.quantity || !can('split')} onClick={() => onExecute({ type: 'split', instanceId: selected.id, quantity: amount })}>Разделить</button>}</div>}
        {compatible && <button className="ghost" disabled={busy || !can('merge')} onClick={() => onExecute({ type: 'merge', instanceId: selected.id, targetInstanceId: compatible.id })}>Объединить со стэком ×{compatible.quantity}</button>}
        {characters.some(character => character.id !== view.ownerId) && <details className="item-secondary"><summary>Передать персонажу</summary><label>Получатель<select value={recipientId === view.ownerId ? '' : recipientId} onChange={event => onRecipient(event.target.value)}><option value="">Выберите персонажа</option>{characters.filter(character => character.id !== view.ownerId).map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><button className="ghost" disabled={busy || !quantityValid || !destination || recipientId === view.ownerId || !can(selected.inventoryId ? 'transfer' : 'put')} onClick={() => { if (destination) onExecute({ type: selected.inventoryId ? 'transfer' : 'put', instanceId: selected.id, targetInventoryId: destination.id, quantity: amount }); }}>Передать {amount} шт.</button></details>}
        <details className="item-secondary delete-item"><summary>Удалить предмет</summary><p className="hint">Будет удалено {amount} шт. Это действие нельзя отменить.</p><button className="ghost" disabled={busy || !quantityValid || !can('delete')} onClick={() => onExecute({ type: 'delete', instanceId: selected.id, quantity: amount })}>Удалить {amount} шт.</button></details>
      </>}
    </div>
  </aside>;
}
