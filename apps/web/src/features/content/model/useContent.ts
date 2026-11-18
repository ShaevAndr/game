import { useCallback, useState } from 'react';
import type { Content } from '@game/core';
import { contentApi } from '../api/content.api';

export function useContent() {
  const [content, setContent] = useState<Content | null>(null);
  const refreshContent = useCallback(async () => setContent(await contentApi.get()), []);
  return { content, refreshContent };
}
