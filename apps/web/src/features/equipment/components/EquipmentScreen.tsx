import { rankedItemDefinition } from '@game/core';
import { ItemQuality, qualityStyle } from '../../inventory/components/ItemQuality';
import { useState } from 'react';
import { Character, InventoryView } from '@game/core';
import { EquipmentPanel, slotNames, statNames } from '../../inventory/components/EquipmentPanel';
import { ItemIcon } from '../../inventory/components/ItemIcon';
import { CharacterAttributes } from '../../characters/components/CharacterAttributes';
import { AttributeAllocationForm } from '../../characters/components/AttributeAllocationForm';

interface Props {
  view: InventoryView; character?: Character; busy: boolean;
  onExecute: (command: { type: 'equip' | 'unequip'; instanceId: string }) => void;
  onRefresh: () => void; onInventory: () => void;
  onAllocate: (allocations: Record<string, number>, expectedRevision: number) => void;
}

export function EquipmentScreen({ view, character, busy, onExecute, onRefresh, onInventory, onAllocate }: Props) {
  const [slot, setSlot] = useState('main-hand');
  const primary = view.inventories.find(inventory => inventory.primary);
  const equipped = view.items.find(item => item.equippedSlot === slot);
  const definition = (itemId: string) => view.definitions.find(item => item.id === itemId);
  const candidates = view.items.filter(item => !item.equippedSlot && item.inventoryId === primary?.id && definition(item.itemId)?.equipSlot === slot);
  const unequip = equipped?.actions.find(action => action.id === 'unequip');
  const occupied = view.items.filter(item => item.inventoryId === primary?.id && !item.equippedSlot).length;
  const quickAction = (id: string) => {
    const item = view.items.find(item => item.id === id);
    const type = item?.equippedSlot ? 'unequip' : 'equip';
    if (!busy && item?.actions.some(action => action.id === type && action.enabled)) onExecute({ type, instanceId: id });
  };

  return <section className="panel inventory-screen equipment-screen">
    <div className="section-heading inventory-heading"><div><div className="section-label">СНАРЯЖЕНИЕ ПЕРСОНАЖА</div><h2>Экипировка · {character?.name ?? 'Герой'}</h2></div><button className="ghost" disabled={busy} onClick={onRefresh}>↻ Обновить</button></div>
    {character?.attributes && view.statDefinitions && <AttributeAllocationForm key={`${character.id}:${character.attributeRevision}`} character={character} definitions={view.statDefinitions} busy={busy} onAllocate={onAllocate}/>}
    <div className="equipment-workspace">
      <EquipmentPanel view={view} character={character} selectedId={equipped?.id ?? ''} selectedSlot={slot}
        onSelect={id => { const item = view.items.find(item => item.id === id); if (item?.equippedSlot) setSlot(item.equippedSlot); }}
        onSlot={setSlot} onQuickAction={quickAction}/>
      <section className="equipment-choices" aria-label="Подбор экипировки">
        <div className="inventory-panel-heading"><h3>{slotNames[slot] ?? slot}</h3><span>Рюкзак: {occupied} / {primary?.capacity ?? 0}</span></div>
        <div className="equipped-item" style={qualityStyle(equipped)}>
          <h4>Сейчас надето</h4>
          {equipped ? <><div className="equipment-item-heading"><ItemIcon item={definition(equipped.itemId)}/><strong>{definition(equipped.itemId)?.name ?? equipped.itemId}</strong></div>
            <ItemQuality item={equipped}/>
            <button className="ghost" disabled={busy || !unequip?.enabled} onClick={() => onExecute({ type: 'unequip', instanceId: equipped.id })}>Снять в рюкзак</button>
            {!unequip?.enabled && <p className="inventory-notice" role="status">{unequip?.reason ?? 'Снять предмет сейчас нельзя.'}</p>}</>
            : <p className="hint">Слот пуст. Выберите вещь из рюкзака ниже.</p>}
        </div>
        <h4>Подходящие вещи в рюкзаке</h4>
        {!candidates.length && <p className="hint equipment-empty">Для этого слота вещей нет. Создайте снаряжение в крафте или откройте инвентарь.</p>}
        <div className="equipment-candidates">{candidates.map(item => {
          const original = definition(item.itemId);
          const details = original && rankedItemDefinition(original, item);
          const action = item.actions.find(action => action.id === 'equip');
          return <article className="equipment-candidate" key={item.id} style={qualityStyle(item)}>
            <div className="equipment-item-heading"><ItemIcon item={details}/><strong>{details?.name ?? item.itemId}</strong></div>
            <ItemQuality item={item}/>
            <p>{details?.description}</p>
            <dl className="item-bonuses">{Object.entries(details?.bonuses ?? {}).map(([key, value]) => <div key={key}><dt>{statNames[key] ?? key}</dt><dd>+{value}</dd></div>)}</dl>
            {!!details?.bonuses?.attack && view.statDefinitions && <p className="hint">Мощь оружия усиливается характеристиками героя. Итоговый вклад — в таблице параметров ниже.</p>}
            {equipped && <p className="hint">«{definition(equipped.itemId)?.name ?? equipped.itemId}» вернётся в рюкзак.</p>}
            <button className="primary" disabled={busy || !action?.enabled} onClick={() => onExecute({ type: 'equip', instanceId: item.id })}>{equipped ? 'Заменить надетое' : 'Надеть'}</button>
            {!action?.enabled && <p className="inventory-notice">{action?.reason ?? 'Надеть предмет сейчас нельзя.'}</p>}
          </article>;
        })}</div>
        <button className="ghost" onClick={onInventory}>Открыть инвентарь →</button>
      </section>
    </div>
    {character?.attributes && view.statDefinitions && <CharacterAttributes attributes={character.attributes} definitions={view.statDefinitions}/>}
    <p className="inventory-footnote">Выберите слот на персонаже, чтобы подобрать снаряжение. Бонусы обновляются после надевания или снятия вещи и действуют со следующего боя.</p>
  </section>;
}
