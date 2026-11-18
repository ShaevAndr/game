import { useCallback, useEffect } from 'react';
import { useCharacters } from '../../features/characters/model/useCharacters';
import { useContent } from '../../features/content/model/useContent';
import { useArena } from '../../features/arena/model/useArena';

export function useGameData(characterId: string, onError: (message: string) => void) {
  const characters = useCharacters(characterId);
  const { refreshCharacters } = characters;
  const { content, refreshContent } = useContent();
  const { arena, refreshArena } = useArena(characterId, onError);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([refreshCharacters(), refreshContent()]).catch(error => {
      if (!cancelled) onError(`${error.message}. Проверьте, что сервер и базы запущены.`);
    });
    return () => { cancelled = true; };
  }, [refreshCharacters, refreshContent, onError]);
  const recover = useCallback(async () => {
    await Promise.allSettled([refreshCharacters(), refreshArena()]);
  }, [refreshCharacters, refreshArena]);
  return { ...characters, content, arena, refreshArena, recover };
}
