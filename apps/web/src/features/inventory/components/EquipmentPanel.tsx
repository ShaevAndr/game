import { qualityStyle } from './ItemQuality';
import { Character, InventoryView, effectiveStats } from '@game/core';
import { ItemIcon } from './ItemIcon';

export const slotNames: Record<string, string> = {
  head: 'Голова', neck: 'Ожерелье', 'main-hand': 'Оружие', body: 'Доспех', hands: 'Перчатки', ring: 'Кольцо', legs: 'Поножи', feet: 'Обувь',
};
export const statNames: Record<string, string> = { attack: 'Атака', defense: 'Защита', maxHp: 'Здоровье', maxEnergy: 'Энергия' };

interface Props {
  view: InventoryView; character?: Character; selectedId: string; selectedSlot: string;
  onSelect: (id: string) => void; onSlot: (slot: string) => void; onQuickAction: (id: string) => void;
}
export function EquipmentPanel({ view, character, selectedId, selectedSlot, onSelect, onSlot, onQuickAction }: Props) {
  const slots = [...new Set([...Object.keys(slotNames), ...view.definitions.flatMap(item => item.equipSlot ? [item.equipSlot] : []), ...view.items.flatMap(item => item.equippedSlot ? [item.equippedSlot] : [])])];
  const stats = character ? effectiveStats(character) : null;
  return <section className="equipment-panel" aria-label="Надетые предметы">
    <div className="inventory-panel-heading"><h3>Экипировка</h3><span>{view.items.filter(item => item.equippedSlot).length} надето</span></div>
    <div className="paperdoll">
      <div className="paperdoll-figure" aria-hidden="true">
        <div className="paperdoll-halo"/>
        <svg viewBox="0 0 160 320" fill="none"><path d="m60 50 7-27h26l7 27-8 26H68Z"/><path d="m68 76-34 22-9 72 17 9 14-52-5 69 19 14h20l19-14-5-69 14 52 17-9-9-72-34-22-12 16Z"/><path d="m51 196 19 14-5 68-8 26H35l9-31Zm58 0-19 14 5 68 8 26h22l-9-31Z"/><path d="m34 98 46 18 46-18M51 172h58M80 116v80M62 51h36"/></svg>
        <span>{character?.name ?? 'Персонаж'}</span><small>{character ? `Уровень ${character.level}` : 'Снаряжение героя'}</small>
      </div>
      <div className="equipment-slots">{slots.map(slot => {
        const instance = view.items.find(item => item.equippedSlot === slot);
        const definition = view.definitions.find(item => item.id === instance?.itemId);
        const label = slotNames[slot] ?? slot;
        return <button key={slot} style={qualityStyle(instance)} className={`equipment-slot ${instance ? 'occupied' : ''} ${instance?.id === selectedId || selectedSlot === slot ? 'selected' : ''}`}
          title={`${label}: ${definition?.name ?? 'Пусто'}${instance?.quality ? ` · ${instance.quality.rank.name}` : ''}`} aria-label={`${label}: ${definition?.name ?? 'Пусто'}${instance?.quality ? ` · ${instance.quality.rank.name}` : ''}`} aria-pressed={instance ? instance.id === selectedId : selectedSlot === slot}
          onClick={() => instance ? onSelect(instance.id) : onSlot(slot)} onDoubleClick={() => { if (instance) onQuickAction(instance.id); }}>
          <ItemIcon item={definition} slot={slot}/><span>{label}</span>
        </button>;
      })}</div>
    </div>
    {stats && <dl className="equipment-stats">{Object.entries(stats).map(([key, value]) => <div key={key}><dt>{statNames[key] ?? key}</dt><dd>{value}{!!character?.equipmentBonuses?.[key as keyof typeof stats] && <small title="В том числе бонус экипировки"> (+{character.equipmentBonuses[key as keyof typeof stats]})</small>}</dd></div>)}</dl>}
  </section>;
}
