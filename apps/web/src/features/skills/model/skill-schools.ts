import type { Element, SkillIcon } from '@game/core';

export const skillSchools: Record<Element, { title: string; motto: string; icon: SkillIcon }> = {
  fire: { title: 'Огонь', motto: 'Покори пламя. Выбери разрушение или силу феникса.', icon: 'flame' },
  water: { title: 'Вода', motto: 'Сковывай врагов льдом или возвращай союзникам силы.', icon: 'drop' },
  earth: { title: 'Земля', motto: 'Пробуди гнев гор и несокрушимую силу живых корней.', icon: 'mountain' },
  air: { title: 'Воздух', motto: 'Призови бурю или обрати ветер в защиту союзников.', icon: 'wind' },
  physical: { title: 'Физические', motto: 'От основ оружия — к натиску, стойкости и хитрости.', icon: 'sword' },
};
