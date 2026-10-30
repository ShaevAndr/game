import type { Battle } from '../types';

export function addLog(battle: Battle, message: string) { battle.log.push(message); battle.log = battle.log.slice(-100); }
