import { Element, Rule } from '@game/core';

export const symbols: Record<Element, string> = { fire: '♨', water: '◆', earth: '⬢', air: '✦', physical: '⚔' };
export const ruleNames: Record<Rule, string> = { before: 'Навык → поле', 'before-after': 'Навык до / после', 'on-match': 'Поле → выбор навыка' };
export const kindNames = { bot: 'Бой с ботом', duel: 'Дуэль', team: 'Командный бой', dungeon: 'Подземелье' };
