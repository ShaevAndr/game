import { Action, Battle, Character, Content } from './types';
import { BattlefieldEngine, BattlefieldOptions, defaultBattlefieldEngine } from './battlefield';
import { characterFighter } from './combat/common';
import { applyLegacyAction, runLegacyNpcTurns } from './combat/legacy';
import { applyMatchedAction, runMatchedNpcTurns } from './combat/matched';
export { characterFighter, addLog, joinBattle, startBattle } from './combat/common';

export function newBattle(id: string, name: string, kind: Battle['kind'], rule: Battle['rule'], creator: Character, content: Content, options: BattlefieldOptions = {}, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine): Battle {
  const field = fieldEngine.create(options);
  return { id, name, kind, rule: 'on-match', combatVersion: 2, skillChoices: [], matchedElements: [], status: 'waiting', version: 0, board: field.board, battlefield: field.config, boardMoves: [], fighters: [characterFighter(creator, 0, content)], activeId: null, turn: 0, phase: 'before', usedSkill: false, pendingMatch: 0, wave: 1, totalWaves: kind === 'dungeon' ? content.balance.dungeonWaves.length : 1, winner: null, log: ['Комната создана. Пригласите игроков или начните подземелье.'], content: structuredClone(content), createdAt: new Date().toISOString() };
}

export function applyAction(battle: Battle, actorId: string, action: Action, random = Math.random, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine) {
  return battle.combatVersion === 2
    ? applyMatchedAction(battle, actorId, action, random, fieldEngine)
    : applyLegacyAction(battle, actorId, action, random, fieldEngine);
}
export function runNpcTurns(battle: Battle, fieldEngine: BattlefieldEngine = defaultBattlefieldEngine, onAction?: () => void) {
  return battle.combatVersion === 2 ? runMatchedNpcTurns(battle, fieldEngine, onAction) : runLegacyNpcTurns(battle, fieldEngine);
}
