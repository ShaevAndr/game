import { Battle, Character, Content, Fighter, emptyEnergy, tileTypes } from '../types';
import { effectiveStats } from '../skills';
import { ENERGY_CAP } from './rules';

export function characterFighter(character: Character, team: number, content: Content): Fighter {
  const stats = effectiveStats(character); stats.maxEnergy = Math.min(ENERGY_CAP, stats.maxEnergy);
  const energy = emptyEnergy();
  for (const type of tileTypes) energy[type] = Math.min(ENERGY_CAP, Math.max(0, character.energy[type] ?? 0));
  return { id: character.id, characterId: character.id, name: character.name, team, npc: false, stats, hp: stats.maxHp, energy, guardDefense: 0, inventory: structuredClone(character.inventory), cooldowns: {}, skillLevels: { ...character.skillLevels }, skillIds: content.skills.filter(s => character.learnedSkillIds.includes(s.id) || s.learning?.starter).map(s => s.id) };
}
export function addLog(battle: Battle, message: string) { battle.log.push(message); battle.log = battle.log.slice(-100); }
export function spawnWave(b: Battle) {
  const enemies = b.content.enemies;
  if (!enemies.length) throw new Error('В MongoDB не настроены противники');
  const enemy = enemies.find(e => e.id === b.content.balance.dungeonWaves[b.wave - 1]);
  if (!enemy) throw new Error('Не настроен противник для волны');
  b.fighters = b.fighters.filter(f => !f.npc);
  b.fighters.push({ id: `npc-${b.wave}`, name: enemy.name, npc: true, team: 1, stats: { ...enemy.stats, ...(b.combatVersion === 2 ? { maxEnergy: ENERGY_CAP } : {}) }, hp: enemy.stats.maxHp, energy: emptyEnergy(), guardDefense: 0, inventory: [], cooldowns: {}, skillIds: [...enemy.skillIds] });
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
    b.fighters.push({ id: 'bot-opponent', name: `Бот: ${hero.name}`, team: 1, npc: true, stats: { ...hero.stats }, hp: hero.stats.maxHp, energy: emptyEnergy(), guardDefense: 0, inventory: [], cooldowns: {}, skillIds: [...hero.skillIds], skillLevels: { ...hero.skillLevels } });
    addLog(b, 'Бот готов: характеристики и навыки соответствуют вашему герою.');
  }
  if (b.kind === 'dungeon') spawnWave(b);
  if (!b.fighters.some(f => f.team === 0) || !b.fighters.some(f => f.team === 1)) throw new Error('Нужен хотя бы один участник в каждой команде');
  // Interleave teams so a full party cannot act repeatedly before its opponent.
  const teams = [b.fighters.filter(f => f.team === 0), b.fighters.filter(f => f.team === 1)];
  b.fighters = Array.from({ length: Math.max(...teams.map(t => t.length)) }, (_, i) => teams.flatMap(t => t[i] ? [t[i]] : [])).flat();
  b.status = 'active'; b.turn = 1; b.activeId = b.fighters[0].id;
  addLog(b, `Бой начался. Ход: ${b.fighters[0].name}`);
}
export function finishOrWave(b: Battle): boolean {
  const livingTeams = new Set(b.fighters.filter(f => f.hp > 0).map(f => f.team));
  if (livingTeams.size > 1) return false;
  if (b.kind === 'dungeon' && livingTeams.has(0) && b.wave < b.totalWaves) { b.wave++; spawnWave(b); return false; }
  b.status = 'finished'; b.winner = [...livingTeams][0] ?? null; b.activeId = null;
  if (b.combatVersion === 2) { b.skillChoices = []; b.matchedElements = []; }
  addLog(b, b.winner === null ? 'Ничья' : `Победила команда ${b.winner + 1}`); return true;
}
export function nextTurn(b: Battle) {
  const currentIndex = b.fighters.findIndex(f => f.id === b.activeId);
  if (finishOrWave(b)) return;
  // A wave may replace the enemy but keeps the player roster in order.
  const index = b.fighters.findIndex(f => f.id === b.activeId);
  const start = index >= 0 ? index : Math.max(0, currentIndex - 1);
  for (let i = 1; i <= b.fighters.length; i++) {
    const next = b.fighters[(start + i) % b.fighters.length];
    if (next.hp <= 0) continue;
    if (b.combatVersion === 2) { next.guardDefense = 0; b.skillChoices = []; b.matchedElements = []; }
    b.activeId = next.id; b.turn++; b.phase = 'before'; b.usedSkill = false; b.pendingMatch = 0;
    for (const id of Object.keys(next.cooldowns)) next.cooldowns[id] = Math.max(0, next.cooldowns[id] - 1);
    addLog(b, `Ход ${b.turn}: ${next.name}`); return;
  }
}
export function target(b: Battle, actor: Fighter, id: string, ally = false): Fighter {
  const value = b.fighters.find(f => f.id === id && f.hp > 0 && (ally ? f.team === actor.team : f.team !== actor.team));
  if (!value) throw new Error(ally ? 'Выберите живого союзника' : 'Выберите живого противника');
  return value;
}
export function damage(b: Battle, actor: Fighter, victim: Fighter, power: number) {
  const guard = b.combatVersion === 2 ? victim.guardDefense ?? 0 : 0;
  const amount = Math.max(1, Math.floor(power + actor.stats.attack - victim.stats.defense - guard));
  victim.hp = Math.max(0, victim.hp - amount); addLog(b, `${actor.name} → ${victim.name}: ${amount} урона`);
}
