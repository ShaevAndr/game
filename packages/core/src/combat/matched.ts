import { Action, Battle, Fighter, SkillChoice, elements, tileTypeNames, tileTypes } from '../types';
import { BattlefieldEngine, defaultBattlefieldEngine, normalizeBattlefieldOptions } from '../battlefield';
import { skillPower } from '../skills';
import { isBattleConsumable } from '../items';
import { addLog, damage, nextTurn, target } from './common';
import { combatRules } from './rules';

/** Choices are restricted by direct matches, but remain visible when energy or cooldown blocks casting. */
export function skillChoices(battle: Battle, actor: Fighter): SkillChoice[] {
  if (battle.phase !== 'choose' || battle.usedSkill) return [];
  return battle.content.skills.filter(skill => actor.skillIds.includes(skill.id) && battle.matchedElements?.includes(skill.element)).map(skill => {
    const reason = (actor.cooldowns[skill.id] ?? 0) > 0 ? 'Навык перезаряжается'
      : (actor.energy[skill.element] ?? 0) < skill.cost ? 'Недостаточно энергии' : undefined;
    return { skillId: skill.id, enabled: !reason, ...(reason ? { reason } : {}) };
  });
}

export function applyMatchedAction(battle: Battle, actorId: string, action: Action, random = Math.random, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine) {
  if (battle.status !== 'active') throw new Error('Бой не активен');
  const actor = battle.fighters.find(fighter => fighter.id === actorId);
  if (!actor || actor.hp <= 0 || battle.activeId !== actorId) throw new Error('Сейчас ход другого участника');
  if (action.type === 'swap') {
    if (battle.phase !== 'before') throw new Error('Разрешена одна перестановка за ход');
    const config = battle.battlefield ?? normalizeBattlefieldOptions({ size: { rows: battle.board.length, cols: battle.board[0]?.length ?? 0 } });
    const { board, config: nextConfig, ...report } = fieldEngine.move({ board: battle.board, config }, action.from, action.to, random);
    const rules = combatRules(battle.content);
    // Resolve every cascade before computing the affordable choices. Defense direct matches are guard, not energy.
    const gains: string[] = [];
    for (const type of tileTypes) {
      const count = (report.generated.byType[type] ?? 0) + (type === 'defense' ? 0 : report.direct.byType[type] ?? 0);
      const previous = actor.energy[type] ?? 0;
      actor.energy[type] = Math.min(rules.energyCap, previous + count * rules.energyPerTile);
      if (actor.energy[type]! > previous) gains.push(`${tileTypeNames[type]} +${actor.energy[type]! - previous}`);
    }
    const guard = (report.direct.byType.defense ?? 0) * rules.defensePerTile;
    actor.guardDefense = (actor.guardDefense ?? 0) + guard;
    battle.board = board; battle.battlefield = nextConfig;
    battle.boardMoves = [...(battle.boardMoves ?? []), { actorId, from: { ...action.from }, to: { ...action.to }, ...report }].slice(-11);
    battle.pendingMatch = report.direct.count;
    battle.matchedElements = elements.filter(type => (report.direct.byType[type] ?? 0) > 0);
    battle.phase = 'choose';
    battle.skillChoices = skillChoices(battle, actor);
    addLog(battle, `${actor.name}: прямо ${report.direct.count}, вторично ${report.generated.count}. Энергия: ${gains.join(', ') || 'без изменений'}${guard ? `. Защита +${guard} до следующего собственного хода` : ''}`);
    if (report.regeneration) addLog(battle, report.regeneration === 'cascade-limit' ? 'Достигнут предел каскадов. Поле обновлено.' : 'Нет доступных ходов. Поле обновлено.');
    // Matching tiles never deals damage. No learned matching skills means energy/guard only and an automatic end.
    if (!battle.skillChoices.length) nextTurn(battle);
    return;
  }
  if (action.type === 'skill') {
    if (battle.phase !== 'choose' || battle.usedSkill) throw new Error('Сначала совместите клетки соответствующего типа');
    const skill = battle.content.skills.find(skill => skill.id === action.skillId && actor.skillIds.includes(skill.id));
    if (!skill || !battle.matchedElements?.includes(skill.element)) throw new Error('Тип навыка не совпал напрямую');
    const choice = skillChoices(battle, actor).find(choice => choice.skillId === skill.id);
    if (!choice?.enabled) throw new Error(choice?.reason ?? 'Навык недоступен');
    const victim = target(battle, actor, action.targetId, skill.effect === 'heal');
    actor.energy[skill.element] -= skill.cost;
    actor.cooldowns[skill.id] = skill.cooldown + (skill.cooldown > 0 ? 1 : 0);
    battle.usedSkill = true;
    addLog(battle, `${actor.name} применяет «${skill.name}»: −${skill.cost} энергии`);
    const power = skillPower(skill, actor.skillLevels?.[skill.id] ?? 1);
    if (skill.effect === 'damage') damage(battle, actor, victim, power);
    else {
      const healed = Math.min(power, victim.stats.maxHp - victim.hp);
      victim.hp += healed; addLog(battle, `${victim.name}: +${healed} HP`);
    }
    nextTurn(battle); return;
  }
  if (action.type === 'item') {
    if (battle.phase !== 'before' || battle.usedSkill) throw new Error('Зелье применяется до перестановки вместо навыка');
    const stack = actor.inventory.find(stack => stack.itemId === action.itemId && stack.quantity > 0);
    const item = battle.content.items.find(item => item.id === action.itemId);
    if (!stack || !item || !isBattleConsumable(item, battle.content.itemGroups)) throw new Error('Предмет недоступен');
    if (actor.hp === actor.stats.maxHp) throw new Error('Здоровье уже полное');
    const healed = Math.min(item.heal!, actor.stats.maxHp - actor.hp);
    stack.quantity--; actor.hp += healed; battle.usedSkill = true;
    addLog(battle, `${actor.name}: ${item.name}, +${healed} HP. Теперь обязательна перестановка.`);
    return;
  }
  if (battle.phase !== 'choose') throw new Error('Сначала выполните перестановку');
  addLog(battle, `${actor.name} сохраняет энергию и завершает ход`);
  nextTurn(battle);
}

export function runMatchedNpcTurns(battle: Battle, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine) {
  for (let count = 0; count < 10 && battle.status === 'active'; count++) {
    const actor = battle.fighters.find(fighter => fighter.id === battle.activeId);
    if (!actor?.npc) return;
    if (battle.phase === 'before') {
      const move = fieldEngine.possibleMove(battle.board);
      if (!move) throw new Error('Нет доступного хода');
      const enemy = battle.fighters.find(fighter => fighter.hp > 0 && fighter.team !== actor.team)!;
      applyMatchedAction(battle, actor.id, { type: 'swap', ...move, targetId: enemy.id }, Math.random, fieldEngine);
    }
    if (battle.status !== 'active' || battle.activeId !== actor.id) continue;
    const available = skillChoices(battle, actor).filter(choice => choice.enabled).map(choice => battle.content.skills.find(skill => skill.id === choice.skillId)!);
    const byPower = (a: typeof available[number], b: typeof available[number]) => skillPower(b, actor.skillLevels?.[b.id] ?? 1) - skillPower(a, actor.skillLevels?.[a.id] ?? 1);
    const heal = actor.hp <= actor.stats.maxHp / 2 ? available.filter(skill => skill.effect === 'heal').sort(byPower)[0] : undefined;
    const skill = heal ?? available.filter(skill => skill.effect === 'damage').sort(byPower)[0];
    if (!skill) { applyMatchedAction(battle, actor.id, { type: 'end' }, Math.random, fieldEngine); continue; }
    const victim = skill.effect === 'heal' ? actor : battle.fighters.find(fighter => fighter.hp > 0 && fighter.team !== actor.team)!;
    applyMatchedAction(battle, actor.id, { type: 'skill', skillId: skill.id, targetId: victim.id }, Math.random, fieldEngine);
  }
}
