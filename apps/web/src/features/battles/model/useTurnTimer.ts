import { useEffect, useState } from 'react';

export function useTurnTimer(deadline: number | undefined, clockOffset: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [deadline, clockOffset]);
  return deadline === undefined ? undefined : Math.max(0, Math.ceil((deadline - now - clockOffset) / 1000));
}
