import { useCallback, useEffect, useState } from 'react';

export type GameScreen = 'arena' | 'world' | 'gathering' | 'skills' | 'inventory' | 'crafting' | 'attributes';

function readRoute() {
  const hash = location.hash.slice(1);
  const screen = hash === 'world' ? 'world' : hash === 'gathering' ? 'gathering' : hash === 'skills' ? 'skills' : hash === 'inventory' || hash === 'equipment' ? 'inventory' : hash === 'crafting' ? 'crafting' : hash === 'attributes' ? 'attributes' : 'arena';
  return { screen, roomId: ['skills', 'inventory', 'crafting', 'equipment', 'attributes', 'gathering', 'world'].includes(hash) ? '' : hash } as const;
}

export function useNavigation() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const openRoom = useCallback((id: string) => { location.hash = id; setRoute({ screen: 'arena', roomId: id }); }, []);
  const openScreen = useCallback((screen: GameScreen) => {
    location.hash = screen === 'arena' ? '' : screen;
    setRoute({ screen, roomId: '' });
  }, []);
  return { ...route, openRoom, openScreen };
}
