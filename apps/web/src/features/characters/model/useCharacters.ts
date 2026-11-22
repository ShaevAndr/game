import { useLiveRefresh } from '../../../shared/model/useLiveRefresh';
import { useCallback, useRef, useState } from 'react';
import { Character } from '@game/core';
import { charactersApi } from '../api/characters.api';

export function useCharacters(characterId = '') {
  const [characters, setCharacters] = useState<Character[]>([]);
  const sequence = useRef(0);
  const refreshCharacters = useCallback(async (signal?: AbortSignal) => { const attempt = ++sequence.current, next = await charactersApi.list(signal); if (!signal?.aborted && attempt === sequence.current) setCharacters(next); }, []);
  useLiveRefresh('characters', true, refreshCharacters);
  const updateCharacter = (character: Character) => {
    sequence.current++;
    setCharacters(current => current.some(value => value.id === character.id)
      ? current.map(value => value.id === character.id ? character : value) : [...current, character]);
  };
  return { characters, characterId, character: characters.find(c => c.id === characterId), refreshCharacters, updateCharacter };
}
