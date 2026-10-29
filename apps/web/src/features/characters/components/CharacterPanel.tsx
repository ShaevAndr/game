import { Character, Content, Fighter, experienceToNextLevel, effectiveStats } from '@game/core';
import { InventoryList } from '../../inventory/components/InventoryList';
import { CharacterCreation } from './CharacterCreation';

interface Props {
  characters: Character[]; characterId: string; character?: Character; content: Content | null;
  fighter?: Fighter; busy: boolean; onChoose: (id: string) => void; onSkills: () => void; onInventory: () => void;
  compact?: boolean;
  onCreate: (name: string, templateId?: string) => Promise<boolean>;
}

export function CharacterPanel({ characters, characterId, character, content, fighter, busy, compact, onChoose, onSkills, onInventory, onCreate }: Props) {
  const stats = fighter?.stats ?? (character ? effectiveStats(character) : null);
  const nextLevel = character && content ? experienceToNextLevel(character.level, content.balance.progression) : 0;
  return <section className="panel">
    <div className="section-label">01 / ПЕРСОНАЖ</div><h2>Выбери героя</h2>
    <label>Активный персонаж<select value={characterId} onChange={event => onChoose(event.target.value)}>
      <option value="">Выберите персонажа</option>
      {characters.map(hero => <option key={hero.id} value={hero.id}>{hero.name} · ур. {hero.level}</option>)}
    </select></label>
    {compact ? <details className="character-create-details"><summary>Создать персонажа</summary><CharacterCreation content={content} busy={busy} onCreate={onCreate}/></details> : <CharacterCreation content={content} busy={busy} onCreate={onCreate}/>}
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
      <button className="ghost" onClick={onInventory}>Рюкзак и экипировка ↗</button>
      <InventoryList stacks={fighter?.inventory ?? character.inventory} items={content?.items ?? []} inBattle={!!fighter}/>
    </> : <p className="hint">Выбери готового героя 10-го уровня или создай своего. Регистрация не нужна.</p>}
  </section>;
}
