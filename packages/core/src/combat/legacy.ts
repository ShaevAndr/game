/** Frozen rules for battles that were already active before combat version 2. */
import { Action, Battle, elements } from '../types';
import { BattlefieldEngine, defaultBattlefieldEngine, normalizeBattlefieldOptions } from '../battlefield';
import { skillPower } from '../skills';
import { isBattleConsumable } from '../items';
import { addLog, damage, finishOrWave, nextTurn, target } from './common';

/** Mutates an isolated snapshot. Persistence must commit it with its version atomically. */
export function applyLegacyAction(b: Battle, actorId: string, action: Action, random = Math.random, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine) {
  if (b.status !== 'active') throw new Error('Бой не активен');
  const actor = b.fighters.find(f => f.id === actorId);
  if (!actor || actor.hp <= 0 || b.activeId !== actorId) throw new Error('Сейчас ход другого участника');
  if (action.type === 'swap') {
    if (b.phase !== 'before') throw new Error('Разрешена одна перестановка за ход');
    const victim = target(b, actor, action.targetId);
    const config = b.battlefield ?? normalizeBattlefieldOptions({ size: { rows: b.board.length, cols: b.board[0]?.length ?? 0 }, elementTypes: elements });
    const { board, config: nextConfig, ...report } = fieldEngine.move({ board: b.board, config }, action.from, action.to, random);
    b.board = board; b.battlefield = nextConfig;
    b.boardMoves = [...(b.boardMoves ?? []), { actorId, from: { ...action.from }, to: { ...action.to }, ...report }].slice(-11);
    const removed = report.total;
    for (const e of elements) actor.energy[e] = Math.min(actor.stats.maxEnergy, actor.energy[e] + (removed.byType[e] ?? 0) * b.content.balance.energyPerTile);
    b.pendingMatch = removed.count;
    addLog(b, `${actor.name}: собрано ${report.direct.count} фишек напрямую и ${report.generated.count} при заполнении, каскадов ${report.cascades}. Энергия: ${elements.filter(e => removed.byType[e]).map(e => `${e} +${(removed.byType[e] ?? 0) * b.content.balance.energyPerTile}`).join(', ')}`);
    if (report.shuffled) addLog(b, report.regeneration === 'cascade-limit' ? 'Достигнут предел каскадов. Поле обновлено.' : 'Нет доступных ходов. Поле обновлено.');
    if (b.rule === 'on-match') { b.phase = 'choose'; return; }
    damage(b, actor, victim, removed.count * b.content.balance.damagePerTile);
    if (b.rule === 'before') nextTurn(b);
    else { b.phase = 'after'; if (finishOrWave(b)) return; }
  } else if (action.type === 'skill') {
    if (b.usedSkill || (b.rule === 'before' && b.phase !== 'before') || (b.rule === 'on-match' && b.phase !== 'choose')) throw new Error('Навык сейчас недоступен');
    const skill = b.content.skills.find(s => s.id === action.skillId && actor.skillIds.includes(s.id));
    if (!skill) throw new Error('Навык не найден');
    if ((actor.cooldowns[skill.id] ?? 0) > 0) throw new Error('Навык перезаряжается');
    if (actor.energy[skill.element] < skill.cost) throw new Error('Недостаточно энергии');
    const victim = target(b, actor, action.targetId, skill.effect === 'heal');
    actor.energy[skill.element] -= skill.cost; actor.cooldowns[skill.id] = skill.cooldown + (skill.cooldown > 0 ? 1 : 0); b.usedSkill = true;
    const power = skillPower(skill, actor.skillLevels?.[skill.id] ?? 1) + (b.rule === 'on-match' ? b.pendingMatch * b.content.balance.damagePerTile : 0);
    addLog(b, `${actor.name} применяет «${skill.name}»`);
    if (skill.effect === 'damage') damage(b, actor, victim, power);
    else { const healed = Math.min(power, victim.stats.maxHp - victim.hp); victim.hp += healed; addLog(b, `${victim.name}: +${healed} HP`); }
    if (b.rule === 'on-match') nextTurn(b); else finishOrWave(b);
  } else if (action.type === 'item') {
    if (b.phase !== 'before' || b.usedSkill || b.rule === 'on-match') throw new Error('Зелье доступно до перестановки вместо навыка');
    const stack = actor.inventory.find(i => i.itemId === action.itemId && i.quantity > 0);
    const item = b.content.items.find(i => i.id === action.itemId);
    if (!stack || !item || !isBattleConsumable(item, b.content.itemGroups)) throw new Error('Предмет недоступен');
    if (actor.hp === actor.stats.maxHp) throw new Error('Здоровье уже полное');
    stack.quantity--; const healed = Math.min(item.heal!, actor.stats.maxHp - actor.hp); actor.hp += healed; b.usedSkill = true;
    addLog(b, `${actor.name}: ${item.name}, +${healed} HP`);
  } else {
    if (b.phase !== 'after') throw new Error('Сначала выполните перестановку и обязательный выбор навыка');
    nextTurn(b);
  }
}
export function runLegacyNpcTurns(b: Battle, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine) {
  for (let n = 0; n < 10 && b.status === 'active'; n++) {
    const actor = b.fighters.find(f => f.id === b.activeId);
    if (!actor?.npc) return;
    let victim = b.fighters.find(f => f.hp > 0 && f.team !== actor.team)!;
    const chooseSkill = () => {
      const available = b.content.skills.filter(s => actor.skillIds.includes(s.id) && actor.energy[s.element] >= s.cost && !(actor.cooldowns[s.id] > 0));
      const heal = actor.hp <= actor.stats.maxHp / 2 ? available.filter(s => s.effect === 'heal').sort((a, c) => skillPower(c, actor.skillLevels?.[c.id] ?? 1) - skillPower(a, actor.skillLevels?.[a.id] ?? 1))[0] : undefined;
      return heal ?? available.filter(s => s.effect === 'damage').sort((a, c) => skillPower(c, actor.skillLevels?.[c.id] ?? 1) - skillPower(a, actor.skillLevels?.[a.id] ?? 1))[0];
    };
    const cast = () => { const s = chooseSkill(); if (!s) throw new Error('Противнику нужен базовый навык без затрат'); applyLegacyAction(b, actor.id, { type: 'skill', skillId: s.id, targetId: s.effect === 'heal' ? actor.id : victim.id }, Math.random, fieldEngine); };
    if (b.rule !== 'on-match') cast();
    if (b.status !== 'active' || b.activeId !== actor.id) continue;
    victim = b.fighters.find(f => f.hp > 0 && f.team !== actor.team)!;
    const move = fieldEngine.possibleMove(b.board); if (!move) throw new Error('Нет доступного хода');
    applyLegacyAction(b, actor.id, { type: 'swap', ...move, targetId: victim.id }, Math.random, fieldEngine);
    if (b.status !== 'active' || b.activeId !== actor.id) continue;
    if (b.phase === 'choose') cast();
    else if (b.phase === 'after') applyLegacyAction(b, actor.id, { type: 'end' }, Math.random, fieldEngine);
  }
}
