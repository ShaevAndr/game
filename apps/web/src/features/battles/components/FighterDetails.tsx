import { useEffect, useRef } from 'react';
import type { Battle, Fighter, ItemInstance } from '@game/core';
import { CharacterAttributes } from '../../characters/components/CharacterAttributes';
import { ActiveEffects } from './ActiveEffects';
import { slotNames } from '../../inventory/components/EquipmentPanel';

export function FighterDetails({ battle, fighter, onClose }: { battle: Battle; fighter?: Fighter; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (fighter && !dialog.current?.open) dialog.current?.showModal();
    if (!fighter && dialog.current?.open) dialog.current.close();
  }, [fighter?.id]);
  const itemList = (items: ItemInstance[] | undefined) => items?.length ? <ul className="fighter-item-list">{items.map(item => {
    const definition = battle.content.items.find(definition => definition.id === item.itemId);
    return <li key={item.id}><strong>{definition?.name ?? item.itemId} ×{item.quantity}</strong>
      {item.equippedSlot && <span>{slotNames[item.equippedSlot] ?? 'Экипировка'}</span>}
      {definition?.description && <small>{definition.description}</small>}
      {item.quality && <small>{item.quality.rank.name}</small>}
    </li>;
  })}</ul> : <p className="hint">Пусто</p>;
  return <dialog ref={dialog} className="fighter-details-dialog" aria-labelledby="fighter-details-title" onCancel={onClose} onClose={onClose}>
    {fighter && <>
      <div className="section-heading"><h2 id="fighter-details-title">{fighter.name}</h2><button className="ghost" onClick={onClose} aria-label="Закрыть просмотр персонажа">Закрыть ×</button></div>
      <p>Команда {fighter.team + 1} · {fighter.hp} / {fighter.stats.maxHp} HP{fighter.surrendered ? ' · Сдался' : fighter.hp === 0 ? ' · Побеждён' : ''}</p>
      {fighter.attributes && battle.content.statDefinitions ? <CharacterAttributes attributes={fighter.attributes} definitions={battle.content.statDefinitions}/> : <p>Атака {fighter.stats.attack} · Защита {fighter.stats.defense}</p>}
      <h3>Баффы и дебаффы</h3>
      {(fighter.guardDefense ?? 0) > 0 && <p>Защита +{fighter.guardDefense} до начала собственного хода</p>}
      {fighter.activeEffects?.length ? <ActiveEffects effects={fighter.activeEffects} fighters={battle.fighters} definitions={battle.content.statDefinitions ?? []}/> : <p className="hint">Нет действующих эффектов</p>}
      <h3>Экипировка</h3>{itemList(fighter.equipment)}
      <h3>Рюкзак</h3>{itemList(fighter.backpack)}
      <h3>Боевой пояс</h3><p className="hint">Осталось {fighter.inventory.reduce((sum, stack) => sum + stack.quantity, 0)} из 10 зелий</p>
      <ul className="fighter-item-list">{fighter.inventory.filter(stack => stack.quantity > 0).map((stack, index) => <li key={stack.instanceId ?? index}>{battle.content.items.find(item => item.id === stack.itemId)?.name ?? stack.itemId} ×{stack.quantity}</li>)}</ul>
    </>}
  </dialog>;
}
