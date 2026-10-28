export * from './types';
export * from './config';
export * from './matches';
export * from './generation';
export * from './move';

import { BattlefieldEngine } from './types';
import { createBattlefield } from './generation';
import { moveBattlefield } from './move';
import { findBattlefieldMove } from './matches';
export const defaultBattlefieldEngine: BattlefieldEngine = { create: createBattlefield, move: moveBattlefield, possibleMove: findBattlefieldMove };
