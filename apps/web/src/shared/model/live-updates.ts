import { createContext } from 'react';
import type { StateTopic } from '@game/core';
export interface LiveUpdates {
  connected: boolean;
  subscribe: (topic: StateTopic, listener: () => void) => () => void;
}
export const LiveUpdatesContext = createContext<LiveUpdates>({ connected: false, subscribe: () => () => {} });
