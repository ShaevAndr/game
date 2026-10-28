import { useEffect, useState } from 'react';

function readRoute() {
  const hash = location.hash.slice(1);
  return { screen: hash === 'skills' ? 'skills' : hash === 'inventory' ? 'inventory' : 'arena', roomId: ['skills', 'inventory'].includes(hash) ? '' : hash } as const;
}

export function useNavigation() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return {
    ...route,
    openRoom: (id: string) => { location.hash = id; setRoute({ screen: 'arena', roomId: id }); },
    openInventory: () => { location.hash = 'inventory'; setRoute({ screen: 'inventory', roomId: '' }); },
    openSkills: () => { location.hash = 'skills'; setRoute({ screen: 'skills', roomId: '' }); },
  };
}
