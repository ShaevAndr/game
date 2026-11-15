import { damageChances } from './formulas';
import { Action, Battle, Fighter, SkillChoice, elements } from '../types';
import { BattlefieldEngine, defaultBattlefieldEngine, normalizeBattlefieldOptions } from '../battlefield';
import { skillMagnitude, skillPower } from '../skills';
import { consumableEffects, isBattleConsumable } from '../items';
import { addLog, damage, finishOrWave, nextTurn, target } from './common';
import { combatRules, skillEnergy } from './rules';
import { legalSkillTargets, resolveSkillTargets, skillTargeting } from '../targeting';
import { applySkillEffects, applyItemEffects, effectSkillUtility, previewSkillEffects } from '../effects/skill-effects';
import { isStunned, removeDeadEffects } from '../effects/lifecycle';
import { matchPowerBps, scaleMatchPower } from './match-power';

function finishMatchedTurn(battle: Battle, actor: Fighter, onBeforeCascades?: (battle: Battle) => void) {
  const pending = battle.pendingBattlefield;
  if (pending?.report.steps.length) onBeforeCascades?.(battle);
  if (pending) {
    const rules = combatRules(battle.content), previous = skillEnergy(actor);
    actor.skillEnergy = Math.min(rules.energyCap, previous + pending.report.generated.count * rules.energyPerTile);
    battle.board = pending.board; battle.battlefield = pending.config;
    if (pending.report.steps.length || pending.report.regeneration) {
      battle.boardMoves = [...(battle.boardMoves ?? []), pending.report].slice(-22);
      addLog(battle, `${actor.name}: вторично ${pending.report.generated.count}. Общая энергия: +${actor.skillEnergy - previous} (${actor.skillEnergy}/${rules.energyCap})`);
    }
    if (pending.report.regeneration) addLog(battle, pending.report.regeneration === 'cascade-limit' ? 'Достигнут предел каскадов. Поле обновлено.' : 'Нет доступных ходов. Поле обновлено.');
    delete battle.pendingBattlefield;
  }
  delete battle.directMatches;
  nextTurn(battle);
}

/** All learned skills stay visible; resonance and blockers are calculated only on the server. */
export function skillChoices(battle: Battle, actor: Fighter): SkillChoice[] {
  if (battle.phase !== 'choose' || battle.usedSkill) return [];
  return battle.content.skills.filter(skill => actor.skillIds.includes(skill.id)).map(skill => {
    let reason = (actor.cooldowns[skill.id] ?? 0) > 0 ? 'Навык перезаряжается'
      : skillEnergy(actor) < skill.cost ? 'Недостаточно энергии' : undefined;
    if (battle.effectsVersion === 1) {
      const targets = legalSkillTargets(battle, actor, skill);
      let effectPreviews;
      if (!targets.length) reason ??= 'Нет допустимой живой цели';
      else if (skill.effects?.length) {
        try { effectPreviews = previewSkillEffects(battle, actor, skill); }
        catch (error) { reason ??= (error as Error).message; }
      }
      return { matchPowerBps: matchPowerBps(battle, skill), skillId: skill.id, enabled: !reason, ...(reason ? { reason } : {}), targeting: skillTargeting(skill), targetIds: targets.map(target => target.id),
        ...(battle.content.balance.formulas && !skill.effects?.length && skill.effect === 'damage' ? { damagePreviews: targets.map(target => ({ targetId: target.id, ...damageChances(battle, actor, target, skill.element) })) } : {}),
        ...(effectPreviews ? { effectPreviews } : actor.attributes ? { magnitude: skillMagnitude(skill, actor.skillLevels?.[skill.id] ?? 1, actor.attributes.effective, battle.content.balance.attributes?.skillReferencePower, matchPowerBps(battle, skill)) } : {}) };
    }
    if (skill.effects?.length) reason ??= 'Навык недоступен в этой версии боя';
    return { matchPowerBps: matchPowerBps(battle, skill), skillId: skill.id, enabled: !reason, ...(reason ? { reason } : {}), ...(actor.attributes ? { magnitude: skillMagnitude(skill, actor.skillLevels?.[skill.id] ?? 1, actor.attributes.effective, battle.content.balance.attributes?.skillReferencePower, matchPowerBps(battle, skill)) } : {}) };
  });
}

export function applyMatchedAction(battle: Battle, actorId: string, action: Action, random = Math.random, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine, onBeforeCascades?: (battle: Battle) => void) {
  if (battle.status !== 'active') throw new Error('Бой не активен');
  const actor = battle.fighters.find(fighter => fighter.id === actorId);
  if (action.type === 'surrender') {
    if (!actor || actor.npc || actor.hp <= 0) throw new Error('Сдаться может только живой участник боя');
    actor.surrendered = true; actor.hp = 0; actor.guardDefense = 0;
    removeDeadEffects(battle);
    addLog(battle, `${actor.name} заканчивает бой: сдача`);
    if (battle.activeId === actor.id) finishMatchedTurn(battle, actor, onBeforeCascades);
    else if (!finishOrWave(battle) && battle.phase === 'choose') {
      const active = battle.fighters.find(fighter => fighter.id === battle.activeId)!;
      battle.skillChoices = skillChoices(battle, active);
    }
    return;
  }
  if (!actor || actor.hp <= 0 || battle.activeId !== actorId) throw new Error('Сейчас ход другого участника');
  if (isStunned(actor)) throw new Error('Участник оглушён и пропускает ход');
  if (action.type === 'swap') {
    if (battle.phase !== 'before') throw new Error('Разрешена одна перестановка за ход');
    const config = battle.battlefield ?? normalizeBattlefieldOptions({ size: { rows: battle.board.length, cols: battle.board[0]?.length ?? 0 } });
    const { board, config: nextConfig, ...report } = fieldEngine.move({ board: battle.board, config }, action.from, action.to, random);
    const rules = combatRules(battle.content);
    // The field resolves RNG once; only the direct step is committed to the visible board now.
    const previous = skillEnergy(actor);
    const count = report.direct.count;
    actor.skillEnergy = Math.min(rules.energyCap, previous + count * rules.energyPerTile);
    const guard = (report.direct.byType.defense ?? 0) * (actor.attributes?.effective.guardPerCell ?? rules.defensePerTile);
    actor.guardDefense = (actor.guardDefense ?? 0) + guard;
    const empty = { count: 0, byType: {} };
    battle.pendingBattlefield = { board, config: nextConfig, report: { ...report, actorId, from: { ...action.from }, to: { ...action.to }, continuation: true,
      direct: empty, total: report.generated, steps: report.steps.filter(step => step.source === 'generated') } };
    battle.board = report.steps[0]?.boardAfter ?? board; battle.battlefield = nextConfig;
    battle.boardMoves = [...(battle.boardMoves ?? []), { ...report, actorId, from: { ...action.from }, to: { ...action.to },
      generated: empty, total: report.direct, cascades: 0, steps: report.steps.filter(step => step.source === 'direct'), shuffled: false, regeneration: null }].slice(-22);
    battle.pendingMatch = report.direct.count;
    battle.directMatches = { ...report.direct.byType };
    battle.matchedElements = elements.filter(type => (report.direct.byType[type] ?? 0) > 0);
    battle.phase = 'choose';
    battle.skillChoices = skillChoices(battle, actor);
    addLog(battle, report.direct.count === 0 ? `${actor.name}: перестановка без совпадений, навыки без усиления`
      : `${actor.name}: прямо ${report.direct.count}, усиление определяется школой навыка. Общая энергия: +${actor.skillEnergy - previous} (${actor.skillEnergy}/${rules.energyCap})${guard ? `. Защита +${guard} до следующего собственного хода` : ''}`);
    // Tiles supply resources, not damage. A used item leaves no skill choices and ends after settlement.
    if (!battle.skillChoices.length) finishMatchedTurn(battle, actor, onBeforeCascades);
    return;
  }
  if (action.type === 'skill') {
    if (battle.phase !== 'choose' || battle.usedSkill) throw new Error('Сначала выполните перестановку');
    const skill = battle.content.skills.find(skill => skill.id === action.skillId && actor.skillIds.includes(skill.id));
    if (!skill) throw new Error('Навык не изучен');
    const choice = skillChoices(battle, actor).find(choice => choice.skillId === skill.id);
    if (!choice?.enabled) throw new Error(choice?.reason ?? 'Навык недоступен');
    if (skill.effects?.length) {
      const draft = structuredClone(battle), caster = draft.fighters.find(fighter => fighter.id === actor.id)!;
      resolveSkillTargets(draft, caster, skill, action.targetId);
      caster.skillEnergy = skillEnergy(caster) - skill.cost; caster.cooldowns[skill.id] = skill.cooldown + (skill.cooldown > 0 ? 1 : 0); draft.usedSkill = true;
      addLog(draft, `${caster.name} применяет «${skill.name}»: −${skill.cost} энергии`);
      applySkillEffects(draft, caster, skill, action.targetId);
      finishMatchedTurn(draft, caster, onBeforeCascades);
      delete battle.pendingBattlefield; delete battle.directMatches;
      Object.assign(battle, draft); return;
    }
    const victim = target(battle, actor, action.targetId, skill.effect === 'heal');
    actor.skillEnergy = skillEnergy(actor) - skill.cost;
    actor.cooldowns[skill.id] = skill.cooldown + (skill.cooldown > 0 ? 1 : 0);
    battle.usedSkill = true;
    addLog(battle, `${actor.name} применяет «${skill.name}»: −${skill.cost} энергии`);
    const power = skillPower(skill, actor.skillLevels?.[skill.id] ?? 1);
    if (skill.effect === 'damage') damage(battle, actor, victim, power, skill.element, skill.id);
    else {
      const magnitude = actor.attributes ? skillMagnitude(skill, actor.skillLevels?.[skill.id] ?? 1, actor.attributes.effective, battle.content.balance.attributes?.skillReferencePower, matchPowerBps(battle, skill)) : scaleMatchPower(battle, power, skill);
      const healed = Math.min(magnitude, victim.stats.maxHp - victim.hp);
      victim.hp += healed; addLog(battle, `${victim.name}: +${healed} HP`);
    }
    finishMatchedTurn(battle, actor, onBeforeCascades); return;
  }
  if (action.type === 'item') {
    if (battle.phase !== 'before' || battle.usedSkill) throw new Error('Зелье применяется до перестановки вместо навыка');
    const stack = actor.inventory.find(stack => stack.itemId === action.itemId && stack.quantity > 0 && (!action.instanceId || stack.instanceId === action.instanceId));
    const item = battle.content.items.find(item => item.id === action.itemId);
    if (!stack || !item || !isBattleConsumable(item, battle.content.itemGroups)) throw new Error('Предмет недоступен');
    const effects = structuredClone(stack.effects ?? consumableEffects(item));
    if (actor.hp === actor.stats.maxHp && effects.every(effect => effect.kind === 'heal')) throw new Error('Здоровье уже полное');
    const draft = structuredClone(battle), caster = draft.fighters.find(fighter => fighter.id === actor.id)!;
    caster.inventory[actor.inventory.indexOf(stack)].quantity--;
    const backpackItem = caster.backpack?.find(item => item.id === stack.instanceId);
    if (backpackItem) {
      backpackItem.quantity--;
      caster.backpack = caster.backpack!.filter(item => item.quantity > 0);
    }
    draft.usedSkill = true;
    addLog(draft, `${actor.name}: ${item.name}. Теперь обязательна перестановка.`);
    applyItemEffects(draft, caster, { id: item.id, name: item.name, effects });
    Object.assign(actor, caster);
    draft.fighters[draft.fighters.findIndex(fighter => fighter.id === actor.id)] = actor;
    Object.assign(battle, draft);
    return;
  }
  if (battle.phase !== 'choose') throw new Error('Сначала выполните перестановку');
  addLog(battle, `${actor.name} сохраняет энергию и завершает ход`);
  finishMatchedTurn(battle, actor, onBeforeCascades);
}

/** The application checks the persisted deadline; core performs an ordinary turn transition. */
export function expireMatchedTurn(battle: Battle, onBeforeCascades?: (battle: Battle) => void) {
  const actor = battle.fighters.find(fighter => fighter.id === battle.activeId);
  if (battle.status !== 'active' || !actor || actor.npc) throw new Error('Нет хода игрока для завершения');
  addLog(battle, `${actor.name}: время хода истекло`);
  if (battle.phase === 'choose') finishMatchedTurn(battle, actor, onBeforeCascades);
  else nextTurn(battle);
}

export function runMatchedNpcTurns(battle: Battle, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine, onAction?: (battle: Battle) => void) {
  for (let count = 0; count < 10 && battle.status === 'active'; count++) {
    const actor = battle.fighters.find(fighter => fighter.id === battle.activeId);
    if (!actor?.npc) return;
    if (battle.phase === 'before') {
      const move = fieldEngine.possibleMove(battle.board);
      if (!move) throw new Error('Нет доступного хода');
      const enemy = battle.fighters.find(fighter => fighter.hp > 0 && fighter.team !== actor.team)!;
      applyMatchedAction(battle, actor.id, { type: 'swap', ...move, targetId: enemy.id }, Math.random, fieldEngine, onAction);
      onAction?.(battle);
    }
    if (battle.status !== 'active' || battle.activeId !== actor.id) continue;
    const available = skillChoices(battle, actor).filter(choice => choice.enabled).map(choice => battle.content.skills.find(skill => skill.id === choice.skillId)!);
    const best = available.flatMap(skill => legalSkillTargets(battle, actor, skill).map(receiver => ({ skill, receiver,
      score: effectSkillUtility(battle, actor, skill, receiver.id) / Math.sqrt(Math.max(1, skill.cost / 3)) })))
      .filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id) || a.receiver.id.localeCompare(b.receiver.id))[0];
    if (!best) { applyMatchedAction(battle, actor.id, { type: 'end' }, Math.random, fieldEngine, onAction); onAction?.(battle); continue; }
    const { skill, receiver: victim } = best;
    applyMatchedAction(battle, actor.id, { type: 'skill', skillId: skill.id, targetId: victim.id }, Math.random, fieldEngine, onAction);
    onAction?.(battle);
  }
  // A control chain must never commit an NPC-owned turn that clients cannot advance.
  if (battle.status === 'active' && battle.fighters.find(fighter => fighter.id === battle.activeId)?.npc) throw new Error('Превышен предел автоматических ходов; команда отменена');
}
