import { qualityStyle } from './ItemQuality';
import { useState } from 'react';
import { Character, InventoryCommand, InventoryContainer, InventoryView } from '@game/core';
import { EquipmentPanel } from './EquipmentPanel';
import { ItemDetails } from './ItemDetails';
import { ItemIcon } from './ItemIcon';

type ClientCommand = Exclude<InventoryCommand, { type: 'receive' }>;
interface Props {
  view: InventoryView; characters: Character[]; busy: boolean; recipientId: string; destinations: InventoryContainer[];
  onRecipient: (id: string) => void; onExecute: (command: ClientCommand) => void; onRefresh: () => void;
}
export function InventoryScreen({ view, characters, busy, recipientId, destinations, onRecipient, onExecute, onRefresh }: Props) {
  const [groupId, setGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [slotFilter, setSlotFilter] = useState('');
  const [sort, setSort] = useState('type');
  const primary = view.inventories.find(inventory => inventory.primary);
  const character = characters.find(character => character.id === view.ownerId);
  const backpack = view.items.filter(item => item.inventoryId === primary?.id && !item.equippedSlot);
  const saved = view.items.filter(item => item.inventoryId !== primary?.id && !item.equippedSlot);
  const name = (itemId: string) => view.definitions.find(item => item.id === itemId)?.name ?? itemId;
  const visible = backpack.filter(item => {
    const definition = view.definitions.find(definition => definition.id === item.itemId);
    return (!groupId || definition?.groupId === groupId) && (!slotFilter || definition?.equipSlot === slotFilter) && name(item.itemId).toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'));
  }).sort((left, right) => {
    const leftGroup = view.definitions.find(item => item.id === left.itemId)?.groupId ?? '';
    const rightGroup = view.definitions.find(item => item.id === right.itemId)?.groupId ?? '';
    return (sort === 'type' ? leftGroup.localeCompare(rightGroup) : 0) || name(left.itemId).localeCompare(name(right.itemId), 'ru') || left.id.localeCompare(right.id);
  });
  const filtered = !!(groupId || search || slotFilter);
  const cells = filtered ? Math.max(visible.length, 8) : primary?.capacity ?? 50;
  const select = (id: string) => { setSelectedId(id); setSlotFilter(''); };
  const quickAction = (id: string) => {
    const item = view.items.find(item => item.id === id);
    const action = item?.equippedSlot ? 'unequip' : 'equip';
    if (!busy && item?.actions.some(value => value.id === action && value.enabled)) onExecute({ type: action, instanceId: id });
  };

  return <section className="panel inventory-screen">
    <div className="section-heading inventory-heading"><div><div className="section-label">СНАРЯЖЕНИЕ ПЕРСОНАЖА</div><h2>{character?.name ? `Инвентарь · ${character.name}` : 'Инвентарь'}</h2></div><button className="ghost" onClick={onRefresh} disabled={busy} aria-label="Обновить инвентарь">↻ Обновить</button></div>
    <div className="rpg-inventory">
      <EquipmentPanel view={view} character={character} selectedId={selectedId} selectedSlot={slotFilter} onSelect={select} onSlot={slot => { setSelectedId(''); setSlotFilter(slot); setGroupId(''); setSearch(''); }} onQuickAction={quickAction}/>
      <section className="backpack-panel" aria-label="Рюкзак">
        <div className="inventory-panel-heading"><h3>Рюкзак</h3><span className={backpack.length >= (primary?.capacity ?? 50) ? 'bag-full' : ''}>{backpack.length} / {primary?.capacity ?? 50} мест</span></div>
        <div className="backpack-filters"><label><span className="sr-only">Поиск предметов</span><input placeholder="Найти предмет…" value={search} onChange={event => setSearch(event.target.value)}/></label><label><span className="sr-only">Группа предметов</span><select value={groupId} onChange={event => { setGroupId(event.target.value); setSlotFilter(''); }}><option value="">Все предметы</option>{view.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
        <div className="backpack-grid" aria-label="Ячейки рюкзака">{Array.from({ length: cells }, (_, index) => {
          const item = visible[index];
          const definition = item && view.definitions.find(definition => definition.id === item.itemId);
          return item ? <button key={item.id} style={qualityStyle(item)} className={`bag-cell occupied ${item.id === selectedId ? 'selected' : ''}`} aria-label={`${name(item.itemId)}, ${item.quality?.rank.name ?? 'Обычный'}, ${item.quantity} шт.`} aria-pressed={item.id === selectedId} title={`${name(item.itemId)}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`} onClick={() => select(item.id)} onDoubleClick={() => quickAction(item.id)}><ItemIcon item={definition}/>{item.quantity > 1 && <span className="stack-count">{item.quantity}</span>}</button>
            : <div key={`empty-${index}`} className="bag-cell empty-cell" aria-hidden="true"><i/></div>;
        })}</div>
        {filtered && !visible.length && <p className="bag-empty" role="status">Подходящих предметов нет.</p>}
        <div className="backpack-footer">{filtered ? <button className="ghost" onClick={() => { setGroupId(''); setSearch(''); setSlotFilter(''); }}>Показать весь рюкзак</button> : <span>{Math.max(0, (primary?.capacity ?? 50) - backpack.length)} свободных мест</span>}<label><span className="sr-only">Порядок предметов</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="type">По типу</option><option value="name">По названию</option></select></label></div>
      </section>
      <ItemDetails key={selectedId} view={view} selectedId={selectedId} characters={characters} busy={busy} recipientId={recipientId} destinations={destinations} onRecipient={onRecipient} onExecute={onExecute}/>
    </div>
    {!!saved.length && <details className="saved-items"><summary>Другие сохранённые предметы <span>{saved.length}</span></summary><p className="hint">Вещи из прежних контейнеров. Выберите предмет и верните его в рюкзак.</p><div className="saved-items-list">{saved.map(item => <button key={item.id} style={qualityStyle(item)} className={item.id === selectedId ? 'selected' : ''} onClick={() => select(item.id)}><ItemIcon item={view.definitions.find(definition => definition.id === item.itemId)}/><span>{name(item.itemId)}{item.quantity > 1 ? ` ×${item.quantity}` : ''}<small>{view.inventories.find(inventory => inventory.id === item.inventoryId)?.name ?? 'Вне рюкзака'}</small></span></button>)}</div></details>}
    <p className="inventory-footnote">Двойной щелчок — надеть или снять вещь. Экипировка не занимает места в рюкзаке. Изменения снаряжения действуют со следующего боя.</p>
  </section>;
}
