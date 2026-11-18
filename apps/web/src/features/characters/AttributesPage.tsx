import type { Character, Content } from '@game/core';
import type { ActionRunner } from '../../shared/model/useAsyncAction';
import { charactersApi } from './api/characters.api';
import { AttributesScreen } from './components/AttributesScreen';

interface Props {
  character?: Character;
  content: Content | null;
  busy: boolean;
  run: ActionRunner;
  onCharacter: (character: Character) => void;
}

export function AttributesPage({ character, content, busy, run, onCharacter }: Props) {
  const allocate = (allocations: Record<string, number>, revision: number) => {
    if (!character) return;
    void run(async () => onCharacter(await charactersApi.allocate(character.id, allocations, revision)));
  };
  return <AttributesScreen character={character} content={content} busy={busy} onAllocate={allocate}/>;
}
