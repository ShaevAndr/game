import { Character, Content, Fighter, experienceToNextLevel, effectiveStats } from '@game/core';
import { InventoryList } from '../../inventory/components/InventoryList';
import '../attributes.css';

interface Props {
  character?: Character; content: Content | null;
  fighter?: Fighter; busy: boolean; onCharacters: () => void; onSkills: () => void; onInventory: () => void; onEquipment: () => void;
  compact?: boolean;
}

export function CharacterPanel({ character, content, fighter, busy, compact, onCharacters, onSkills, onInventory, onEquipment }: Props) {
  const stats = fighter?.stats ?? (character ? effectiveStats(character) : null);
  const nextLevel = character && content ? experienceToNextLevel(character.level, content.balance.progression) : 0;
  return <section className="panel">
    <div className="section-label">01 / ПЕРСОНАЖ</div><h2>{character?.name ?? 'Твой герой'}</h2>
    <button className="ghost" disabled={busy} onClick={onCharacters}>Выбор персонажа →</button>
    {character ? compact ? null : <>
      <div className="hero-card"><div className="avatar">{character.name[0].toUpperCase()}</div><div>
        <strong>{character.name}</strong><span>{content?.characterTemplates.find(template => template.id === character.templateId)?.name ?? 'Странник'} · уровень {character.level}</span>
      </div></div>
      <div className="character-progress"><div><span>Опыт</span><b>{character.experience} / {nextLevel}</b></div>
        <progress aria-label="Опыт" value={character.experience} max={nextLevel || 1}/>
        <button className="ghost" onClick={onSkills}>Очки навыков: {character.skillPoints} <span>↗</span></button>
      </div>
      <div className="stats">
        <div><span>Здоровье</span><b>{stats?.maxHp}</b></div>
        <div><span>Атака</span><b>{stats?.attack}</b></div>
        <div><span>Защита</span><b>{stats?.defense}{fighter?.guardDefense ? ` + ${fighter.guardDefense}` : ''}</b></div>
        <div><span>Лимит энергии</span><b>{stats?.maxEnergy}</b></div>
      </div>
      {character.baseAttributes && content?.statDefinitions && <><div className="primary-attributes-summary">{content.statDefinitions.filter(definition => definition.kind === 'primary').sort((left, right) => left.displayOrder - right.displayOrder).map(definition => <div key={definition.id}>{definition.name}<b>{character.baseAttributes![definition.id]}</b></div>)}</div>
        <button className="ghost" onClick={onEquipment}>Очки характеристик: {character.attributePoints ?? 0} ↗</button></>}
      <button className="ghost" onClick={onEquipment}>Экипировка ↗</button>
      <button className="ghost" onClick={onInventory}>Рюкзак ↗</button>
      <InventoryList stacks={fighter?.inventory ?? character.inventory} items={content?.items ?? []} inBattle={!!fighter}/>
    </> : <p className="hint">Выбери героя своего аккаунта на странице персонажей.</p>}
  </section>;
}
