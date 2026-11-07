import { useCallback, useState } from 'react';
import { Character } from '@game/core';
import { charactersApi } from '../api/characters.api';

export function useCharacters(characterId = '') {
  const [characters, setCharacters] = useState<Character[]>([]);
  const refreshCharacters = useCallback(async () => { setCharacters(await charactersApi.list()); }, []);
  const updateCharacter = (character: Character) => setCharacters(current => current.map(c => c.id === character.id ? character : c));
  return { characters, characterId, character: characters.find(c => c.id === characterId), refreshCharacters, updateCharacter };
}
