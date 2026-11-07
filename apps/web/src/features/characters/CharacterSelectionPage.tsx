import { useCallback, useEffect, useState } from 'react';
import type { Account, Content } from '@game/core';
import { charactersApi } from './api/characters.api';
import { contentApi } from '../content/api/content.api';
import { useCharacters } from './model/useCharacters';
import { CharacterSelectionScreen } from './components/CharacterSelectionScreen';

export function CharacterSelectionPage({ account, busy, error, onChoose, onAccount }: { account: Account; busy: boolean; error: string; onChoose: (id: string) => void; onAccount: () => void }) {
  const { characters, refreshCharacters } = useCharacters();
  const [content, setContent] = useState<Content | null>(null), [loading, setLoading] = useState(true), [creating, setCreating] = useState(false), [localError, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const [catalog] = await Promise.all([contentApi.get(), refreshCharacters()]); setContent(catalog); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [refreshCharacters]);
  useEffect(() => { void load(); }, [load]);
  return <CharacterSelectionScreen account={account} characters={characters} content={content} loading={loading} busy={busy || creating} error={error || localError} onChoose={onChoose} onAccount={onAccount} onRefresh={() => void load()}
    onCreate={async (name, templateId) => {
      setCreating(true); setError('');
      try { await charactersApi.create(name, templateId); await refreshCharacters(); return true; }
      catch (reason) { setError((reason as Error).message); return false; }
      finally { setCreating(false); }
    }}/>;
}
