import { useEffect, useState } from 'react';
import { Character, InventoryCommand, InventoryContainer, InventoryView } from '@game/core';

type ClientCommand = Exclude<InventoryCommand, { type: 'receive' }>;
interface Props {
  view: InventoryView; characters: Character[]; busy: boolean; recipientId: string; destinations: InventoryContainer[];
  onRecipient: (id: string) => void; onExecute: (command: ClientCommand) => void; onRefresh: () => void;
}

export function InventoryScreen({ view, characters, busy, recipientId, destinations, onRecipient, onExecute, onRefresh }: Props) {
  const [inventoryId, setInventoryId] = useState(view.inventories.find(inventory => inventory.primary)?.id ?? '');
  const [groupId, setGroupId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState(1);
  const [targetId, setTargetId] = useState('');
  const [mergeId, setMergeId] = useState('');
  const [name, setName] = useState('');
  const selected = view.items.find(item => item.id === selectedId);
  const definition = view.definitions.find(item => item.id === selected?.itemId);
  const inventory = view.inventories.find(inventory => inventory.id === inventoryId);
  const visible = view.items.filter(item => item.inventoryId === (inventoryId || null) && (!groupId || view.definitions.find(definition => definition.id === item.itemId)?.groupId === groupId));
  const compatible = selected ? view.items.filter(item => item.id !== selected.id && item.itemId === selected.itemId && item.inventoryId === selected.inventoryId && !item.equippedSlot && item.quantity + selected.quantity <= (definition?.stackLimit ?? 0)) : [];
  const can = (action: string) => selected?.actions.some(value => value.id === action && value.enabled) ?? false;
  useEffect(() => { setAmount(1); setMergeId(''); }, [selectedId]);
  const quantityValid = !!selected && Number.isInteger(amount) && amount > 0 && amount <= selected.quantity;
  const destination = destinations.find(inventory => inventory.id === targetId);

  return <section className="panel inventory-screen">
    <div className="section-heading"><div><div className="section-label">ИМУЩЕСТВО ПЕРСОНАЖА</div><h2>Инвентари и снаряжение</h2></div><button className="ghost" onClick={onRefresh} disabled={busy}>Обновить ↻</button></div>
    <p className="hint">«Убрать» сохраняет предмет вне контейнера. «Удалить» уничтожает выбранное количество. Экипировку нужно снять перед переносом. Изменения применяются к следующему бою.</p>
    <div className="inventory-tabs">
      {view.inventories.map(container => <button key={container.id} className={inventoryId === container.id ? 'chosen' : ''} onClick={() => { setInventoryId(container.id); setSelectedId(''); }}>{container.name} {view.items.filter(item => item.inventoryId === container.id).length}/{container.capacity}</button>)}
      <button className={!inventoryId ? 'chosen' : ''} onClick={() => { setInventoryId(''); setSelectedId(''); }}>Вне инвентаря</button>
    </div>
    <div className="form-grid">
      <label>Группа предметов<select value={groupId} onChange={event => { setGroupId(event.target.value); setSelectedId(''); }}><option value="">Все группы</option>{view.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <form className="inline-form" onSubmit={event => { event.preventDefault(); onExecute({ type: 'create-inventory', ownerId: view.ownerId, name, capacity: 50 }); setName(''); }}><input aria-label="Название нового инвентаря" placeholder="Новый инвентарь" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={48}/><button disabled={busy || name.trim().length < 2 || view.inventories.length >= 20}>Создать</button></form>
    </div>
    <h3>{inventory?.name ?? 'Предметы вне инвентаря'}</h3>
    <div className="inventory-workspace">
      <div className="inventory-items">{visible.length ? visible.map(item => <button key={item.id} className={`inventory-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
        <strong>{view.definitions.find(definition => definition.id === item.itemId)?.name ?? item.itemId}</strong><span>×{item.quantity}{item.equippedSlot ? ' · Экипирован' : ''}</span>
      </button>) : <p className="hint">Здесь пока нет предметов.</p>}</div>
      {selected && definition ? <article className="item-details">
        <div className="section-label">{view.groups.find(group => group.id === definition.groupId)?.name}</div>
        <h3>{definition.name}</h3><p>{definition.description}</p>
        <p className="hint">Количество: {selected.quantity}. Максимум в стэке: {definition.stackLimit}.{selected.equippedSlot ? ' Экипирован.' : ''}</p>
        <div className="item-actions">{selected.actions.filter(action => ['equip', 'unequip', 'read'].includes(action.id)).map(action => <button key={action.id} disabled={busy || !action.enabled} title={action.reason} onClick={() => onExecute({ type: action.id as 'equip' | 'unequip' | 'read', instanceId: selected.id })}>{action.label}</button>)}</div>
        {selected.actions.some(action => action.id === 'use-in-battle') && <p className="hint">Зелье применяется на экране боя и расходуется только в этом бою.</p>}
        <label>Количество для действия<input type="number" min={1} max={selected.quantity} value={amount} onChange={event => setAmount(Number(event.target.value))}/></label>
        <div className="item-actions">
          {selected.inventoryId && <button disabled={busy || !quantityValid || !can('remove')} onClick={() => onExecute({ type: 'remove', instanceId: selected.id, quantity: amount })}>Убрать из инвентаря</button>}
          {selected.actions.some(action => action.id === 'split') && <button disabled={busy || !quantityValid || amount === selected.quantity || !can('split')} onClick={() => onExecute({ type: 'split', instanceId: selected.id, quantity: amount })}>Разделить стэк</button>}
          <button className="ghost" disabled={busy || !quantityValid || !can('delete')} onClick={() => onExecute({ type: 'delete', instanceId: selected.id, quantity: amount })}>Удалить {amount}</button>
        </div>
        <div className="form-grid"><label>Получатель<select value={recipientId} onChange={event => { onRecipient(event.target.value); setTargetId(''); }}>
          {characters.map(character => <option key={character.id} value={character.id}>{character.name}{character.id === view.ownerId ? ' (ты)' : ''}</option>)}
        </select></label><label>Целевой инвентарь<select value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Выберите инвентарь</option>{destinations.filter(inventory => inventory.id !== selected.inventoryId).map(inventory => <option key={inventory.id} value={inventory.id}>{inventory.name}</option>)}</select></label></div>
        <button disabled={busy || !quantityValid || !destination || !can(selected.inventoryId ? 'transfer' : 'put')} onClick={() => onExecute({ type: selected.inventoryId ? 'transfer' : 'put', instanceId: selected.id, targetInventoryId: targetId, quantity: amount })}>{selected.inventoryId ? 'Перенести' : 'Положить в инвентарь'}</button>
        {compatible.length > 0 && <><label>Объединить с<select value={mergeId} onChange={event => setMergeId(event.target.value)}><option value="">Выберите стэк</option>{compatible.map(item => <option key={item.id} value={item.id}>{definition.name} ×{item.quantity}</option>)}</select></label><button disabled={busy || !mergeId || !can('merge')} onClick={() => onExecute({ type: 'merge', instanceId: selected.id, targetInstanceId: mergeId })}>Объединить стэки</button></>}
      </article> : <article className="item-details"><p className="hint">Выберите предмет, чтобы увидеть описание и действия.</p></article>}
    </div>
  </section>;
}
