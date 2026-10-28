import { TileType, Rule } from '@game/core';

export const symbols: Record<TileType, string> = { fire: '♨', water: '◆', earth: '⬢', air: '✦', physical: '⚔', defense: '⛨' };
export const ruleNames: Record<Rule, string> = { before: 'Навык → поле', 'before-after': 'Навык до / после', 'on-match': 'Поле → выбор навыка' };
export const kindNames = { bot: 'Бой с ботом', duel: 'Дуэль', team: 'Командный бой', dungeon: 'Подземелье' };
