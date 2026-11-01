import { TileType, Rule } from '@game/core';

export const symbols: Record<TileType, string> = { fire: '♨', water: '◆', earth: '⬢', air: '✦', physical: '⚔', defense: '⛨' };
export const ruleNames: Record<Rule, string> = { 'on-match': 'Поле → выбор навыка → каскады' };
export const kindNames = { bot: 'Бой с ботом', duel: 'Дуэль', team: 'Командный бой', dungeon: 'Подземелье' };
