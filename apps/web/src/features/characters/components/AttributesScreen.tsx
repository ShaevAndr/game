import { experienceToNextLevel, type Character, type Content } from '@game/core';
import { AttributeAllocationForm } from './AttributeAllocationForm';
import { CharacterAttributes } from './CharacterAttributes';

interface Props {
  character?: Character; content: Content | null; busy: boolean;
  onAllocate: (allocations: Record<string, number>, expectedRevision: number) => void;
}

export function AttributesScreen({ character, content, busy, onAllocate }: Props) {
  if (!character || !content) return <section className="panel" role="status">Загрузка характеристик…</section>;
  const nextLevel = experienceToNextLevel(character.level, content.balance.progression);
  return <section className="panel attributes-screen">
    <div className="section-heading"><h2>Характеристики · {character.name}</h2><span>Уровень {character.level}</span></div>
    <div className="character-progress"><span>Опыт: {character.experience} / {nextLevel}</span><progress aria-label="Опыт" value={character.experience} max={nextLevel || 1}/></div>
    {content.statDefinitions && <>
      <AttributeAllocationForm key={`${character.id}:${character.attributeRevision}`} character={character} definitions={content.statDefinitions} busy={busy} onAllocate={onAllocate}/>
      {character.attributes && <CharacterAttributes attributes={character.attributes} definitions={content.statDefinitions}/>}
    </>}
  </section>;
}
