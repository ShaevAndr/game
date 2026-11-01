import { Battle, Character, Content, Fighter, emptyEnergy, tileTypes } from '../types';
import { effectiveStats } from '../skills';
import { ENERGY_CAP, totalEnergy } from './rules';
import { projectCharacterAttributes } from '../attributes/character';
import { addLog } from './log';
import { endEffectTurn, initializeEffectFighter, isStunned, removeDeadEffects } from '../effects/lifecycle';
export { addLog } from './log';
export { damage } from './damage';

export function characterFighter(character: Character, team: number, content: Content): Fighter {
  character = projectCharacterAttributes(character, content);
  const stats = effectiveStats(character); stats.maxEnergy = Math.min(ENERGY_CAP, stats.maxEnergy);
  const energy = emptyEnergy();
  for (const type of tileTypes) energy[type] = Math.min(ENERGY_CAP, Math.max(0, character.energy[type] ?? 0));
  return { ...(content.balance.formulas ? { combatLevel: character.level } : {}), id: character.id, characterId: character.id, name: character.name, team, npc: false, stats, hp: stats.maxHp, energy, skillEnergy: totalEnergy(energy), guardDefense: 0, inventory: structuredClone(character.inventory), cooldowns: {}, skillLevels: { ...character.skillLevels }, skillIds: content.skills.filter(s => character.learnedSkillIds.includes(s.id) || s.learning?.starter).map(s => s.id),
    ...(content.statDefinitions && character.attributes ? { attributes: structuredClone(character.attributes), attributeState: { ...(content.balance.formulas ? { level: character.level } : {}), baseAttributes: { ...character.baseAttributes }, equipmentModifiers: structuredClone(character.equipmentModifiers ?? []), equipmentScaling: structuredClone(character.equipmentScaling ?? []), temporaryModifiers: [] } } : {}) };
}
export function spawnWave(b: Battle) {
  const enemies = b.content.enemies;
  if (!enemies.length) throw new Error('В MongoDB не настроены противники');
  const enemy = enemies.find(e => e.id === b.content.balance.dungeonWaves[b.wave - 1]);
  if (!enemy) throw new Error('Не настроен противник для волны');
  b.fighters = b.fighters.filter(f => !f.npc);
  b.fighters.push({ ...(b.content.balance.formulas ? { combatLevel: enemy.level ?? 1 } : {}), id: `npc-${b.wave}`, name: enemy.name, npc: true, team: 1, stats: { ...enemy.stats, maxEnergy: ENERGY_CAP }, hp: enemy.stats.maxHp, energy: emptyEnergy(), skillEnergy: 0, guardDefense: 0, inventory: [], cooldowns: {}, skillIds: [...enemy.skillIds] });
  initializeEffectFighter(b, b.fighters[b.fighters.length - 1]);
  addLog(b, `Волна ${b.wave}/${b.totalWaves}: ${enemy.name}`);
}
export function joinBattle(b: Battle, character: Character, team: number) {
  if (b.status !== 'waiting') throw new Error('Бой уже начался');
  if (b.kind === 'bot') throw new Error('Бой с ботом рассчитан на одного игрока');
  if (b.fighters.some(f => f.id === character.id)) throw new Error('Персонаж уже в комнате');
  if (b.kind === 'dungeon' && team !== 0) throw new Error('В подземелье игроки в одной команде');
  const limit = b.kind === 'duel' ? 1 : b.content.balance.teamSize;
  if (b.fighters.filter(f => f.team === team).length >= limit) throw new Error('Команда заполнена');
  b.fighters.push(characterFighter(character, team, b.content)); addLog(b, `${character.name} вступает в команду ${team + 1}`);
}
export function startBattle(b: Battle) {
  if (b.status !== 'waiting') throw new Error('Бой уже начался');
  if (b.kind === 'bot') {
    if (b.fighters.length !== 1 || b.fighters[0].npc || b.fighters[0].team !== 0) throw new Error('Для боя с ботом нужен один игрок');
    const hero = b.fighters[0];
    b.fighters.push({ ...(hero.combatLevel ? { combatLevel: hero.combatLevel } : {}), id: 'bot-opponent', name: `Бот: ${hero.name}`, team: 1, npc: true, stats: { ...hero.stats }, hp: hero.stats.maxHp, energy: emptyEnergy(), skillEnergy: 0, guardDefense: 0, inventory: [], cooldowns: {}, skillIds: [...hero.skillIds], skillLevels: { ...hero.skillLevels }, ...(hero.attributes ? { attributes: structuredClone(hero.attributes), attributeState: structuredClone(hero.attributeState) } : {}) });
    addLog(b, 'Бот готов: характеристики и навыки соответствуют вашему герою.');
  }
  if (b.kind === 'dungeon') spawnWave(b);
  if (!b.fighters.some(f => f.team === 0) || !b.fighters.some(f => f.team === 1)) throw new Error('Нужен хотя бы один участник в каждой команде');
  // Interleave teams so a full party cannot act repeatedly before its opponent.
  const teams = [b.fighters.filter(f => f.team === 0), b.fighters.filter(f => f.team === 1)];
  b.fighters = Array.from({ length: Math.max(...teams.map(t => t.length)) }, (_, i) => teams.flatMap(t => t[i] ? [t[i]] : [])).flat();
  b.status = 'active'; b.turn = 1; b.activeId = b.fighters[0].id; b.phase = 'before'; b.usedSkill = false; b.pendingMatch = 0;
  if (b.effectsVersion === 1) { for (const fighter of b.fighters) initializeEffectFighter(b, fighter); b.fighters[0].turnsStarted = 1; }
  addLog(b, `Бой начался. Ход: ${b.fighters[0].name}`);
}
export function finishOrWave(b: Battle): boolean {
  const livingTeams = new Set(b.fighters.filter(f => f.hp > 0).map(f => f.team));
  if (livingTeams.size > 1) return false;
  if (b.kind === 'dungeon' && livingTeams.has(0) && b.wave < b.totalWaves) { b.wave++; spawnWave(b); return false; }
  b.status = 'finished'; b.winner = [...livingTeams][0] ?? null; b.activeId = null;
  b.skillChoices = []; b.matchedElements = [];
  addLog(b, b.winner === null ? 'Ничья' : `Победила команда ${b.winner + 1}`); return true;
}
export function nextTurn(b: Battle) {
  // A stunned turn starts and ends normally, but grants no action or board move.
  while (true) {
    if (b.effectsVersion === 1) {
      const current = b.fighters.find(fighter => fighter.id === b.activeId);
      if (current) endEffectTurn(b, current);
      removeDeadEffects(b);
    }
    const currentIndex = b.fighters.findIndex(f => f.id === b.activeId);
    if (finishOrWave(b)) return;
    // A wave may replace the enemy but keeps the player roster in order.
    const index = b.fighters.findIndex(f => f.id === b.activeId);
    const start = index >= 0 ? index : Math.max(0, currentIndex - 1);
    for (let i = 1; i <= b.fighters.length; i++) {
      const next = b.fighters[(start + i) % b.fighters.length];
      if (next.hp <= 0) continue;
      next.guardDefense = 0; b.skillChoices = []; b.matchedElements = [];
      if (b.effectsVersion === 1) { initializeEffectFighter(b, next); next.turnsStarted = (next.turnsStarted ?? 0) + 1; }
      b.activeId = next.id; b.turn++; b.phase = 'before'; b.usedSkill = false; b.pendingMatch = 0;
      for (const id of Object.keys(next.cooldowns)) next.cooldowns[id] = Math.max(0, next.cooldowns[id] - 1);
      addLog(b, `Ход ${b.turn}: ${next.name}`);
      if (isStunned(next)) { addLog(b, `${next.name} оглушён и пропускает ход`); break; }
      return;
    }
  }
}
export function target(b: Battle, actor: Fighter, id: string, ally = false): Fighter {
  const value = b.fighters.find(f => f.id === id && f.hp > 0 && (ally ? f.team === actor.team : f.team !== actor.team));
  if (!value) throw new Error(ally ? 'Выберите живого союзника' : 'Выберите живого противника');
  return value;
}
