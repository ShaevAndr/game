import { useEffect, useState } from 'react';

function readRoute() {
  const hash = location.hash.slice(1);
  const screen = hash === 'world' ? 'world' : hash === 'gathering' ? 'gathering' : hash === 'skills' ? 'skills' : hash === 'inventory' ? 'inventory' : hash === 'crafting' ? 'crafting' : hash === 'equipment' ? 'equipment' : 'arena';
  return { screen, roomId: ['skills', 'inventory', 'crafting', 'equipment', 'gathering', 'world'].includes(hash) ? '' : hash } as const;
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
    openEquipment: () => { location.hash = 'equipment'; setRoute({ screen: 'equipment', roomId: '' }); },
    openCrafting: () => { location.hash = 'crafting'; setRoute({ screen: 'crafting', roomId: '' }); },
    openGathering: () => { location.hash = 'gathering'; setRoute({ screen: 'gathering', roomId: '' }); },
    openWorld: () => { location.hash = 'world'; setRoute({ screen: 'world', roomId: '' }); },
    openSkills: () => { location.hash = 'skills'; setRoute({ screen: 'skills', roomId: '' }); },
  };
}
