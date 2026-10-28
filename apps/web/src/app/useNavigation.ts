import { useEffect, useState } from 'react';

function readRoute() {
  const hash = location.hash.slice(1);
  return { screen: hash === 'skills' ? 'skills' : 'arena', roomId: hash === 'skills' ? '' : hash } as const;
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
    openSkills: () => { location.hash = 'skills'; setRoute({ screen: 'skills', roomId: '' }); },
  };
}
