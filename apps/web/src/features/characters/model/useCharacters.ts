import { useCallback, useState } from 'react';
import { Character } from '@game/core';
import { charactersApi } from '../api/characters.api';

export function useCharacters() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterId, setCharacterId] = useState(() => sessionStorage.getItem('character') ?? '');
  const refreshCharacters = useCallback(async () => { setCharacters(await charactersApi.list()); }, []);
  const chooseCharacter = (id: string) => { setCharacterId(id); sessionStorage.setItem('character', id); };
  const updateCharacter = (character: Character) => setCharacters(current => current.map(c => c.id === character.id ? character : c));
  return { characters, characterId, character: characters.find(c => c.id === characterId), refreshCharacters, chooseCharacter, updateCharacter };
}
