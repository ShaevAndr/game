import { Action, Battle, Character, Content, Fighter, elements, emptyEnergy } from './types';
import { createBoard, possibleMove, resolveSwap } from './board';

export function characterFighter(character: Character, team: number, content: Content): Fighter {
  return { id: character.id, characterId: character.id, name: character.name, team, npc: false, stats: { ...character.stats }, hp: character.stats.maxHp, energy: { ...character.energy }, inventory: structuredClone(character.inventory), cooldowns: {}, skillIds: content.skills.filter(s => character.learnedSkillIds.includes(s.id) || s.learning?.starter).map(s => s.id) };
}
export function addLog(battle: Battle, message: string) { battle.log.push(message); battle.log = battle.log.slice(-100); }
function spawnWave(b: Battle) {
  const enemies = b.content.enemies;
  if (!enemies.length) throw new Error('В MongoDB не настроены противники');
  const enemy = enemies.find(e => e.id === b.content.balance.dungeonWaves[b.wave - 1]);
  if (!enemy) throw new Error('Не настроен противник для волны');
  b.fighters = b.fighters.filter(f => !f.npc);
  b.fighters.push({ id: `npc-${b.wave}`, name: enemy.name, npc: true, team: 1, stats: { ...enemy.stats }, hp: enemy.stats.maxHp, energy: emptyEnergy(), inventory: [], cooldowns: {}, skillIds: [...enemy.skillIds] });
  addLog(b, `Волна ${b.wave}/${b.totalWaves}: ${enemy.name}`);
}
export function newBattle(id: string, name: string, kind: Battle['kind'], rule: Battle['rule'], creator: Character, content: Content): Battle {
  return { id, name, kind, rule, status: 'waiting', version: 0, board: createBoard(), fighters: [characterFighter(creator, 0, content)], activeId: null, turn: 0, phase: 'before', usedSkill: false, pendingMatch: 0, wave: 1, totalWaves: kind === 'dungeon' ? content.balance.dungeonWaves.length : 1, winner: null, log: ['Комната создана. Пригласите игроков или начните подземелье.'], content: structuredClone(content), createdAt: new Date().toISOString() };
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
    b.fighters.push({ id: 'bot-opponent', name: `Бот: ${hero.name}`, team: 1, npc: true, stats: { ...hero.stats }, hp: hero.stats.maxHp, energy: emptyEnergy(), inventory: [], cooldowns: {}, skillIds: [...hero.skillIds] });
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
function finishOrWave(b: Battle): boolean {
  const livingTeams = new Set(b.fighters.filter(f => f.hp > 0).map(f => f.team));
  if (livingTeams.size > 1) return false;
  if (b.kind === 'dungeon' && livingTeams.has(0) && b.wave < b.totalWaves) { b.wave++; spawnWave(b); return false; }
  b.status = 'finished'; b.winner = [...livingTeams][0] ?? null; b.activeId = null;
  addLog(b, b.winner === null ? 'Ничья' : `Победила команда ${b.winner + 1}`); return true;
}
function nextTurn(b: Battle) {
  const currentIndex = b.fighters.findIndex(f => f.id === b.activeId);
  if (finishOrWave(b)) return;
  // A wave may replace the enemy but keeps the player roster in order.
  const index = b.fighters.findIndex(f => f.id === b.activeId);
  const start = index >= 0 ? index : Math.max(0, currentIndex - 1);
  for (let i = 1; i <= b.fighters.length; i++) {
    const next = b.fighters[(start + i) % b.fighters.length];
    if (next.hp <= 0) continue;
    b.activeId = next.id; b.turn++; b.phase = 'before'; b.usedSkill = false; b.pendingMatch = 0;
    for (const id of Object.keys(next.cooldowns)) next.cooldowns[id] = Math.max(0, next.cooldowns[id] - 1);
    addLog(b, `Ход ${b.turn}: ${next.name}`); return;
  }
}
function target(b: Battle, actor: Fighter, id: string, ally = false): Fighter {
  const value = b.fighters.find(f => f.id === id && f.hp > 0 && (ally ? f.team === actor.team : f.team !== actor.team));
  if (!value) throw new Error(ally ? 'Выберите живого союзника' : 'Выберите живого противника');
  return value;
}
function damage(b: Battle, actor: Fighter, victim: Fighter, power: number) {
  const amount = Math.max(1, Math.floor(power + actor.stats.attack - victim.stats.defense));
  victim.hp = Math.max(0, victim.hp - amount); addLog(b, `${actor.name} → ${victim.name}: ${amount} урона`);
}
/** Mutates an isolated snapshot. Persistence must commit it with its version atomically. */
export function applyAction(b: Battle, actorId: string, action: Action, random = Math.random) {
  if (b.status !== 'active') throw new Error('Бой не активен');
  const actor = b.fighters.find(f => f.id === actorId);
  if (!actor || actor.hp <= 0 || b.activeId !== actorId) throw new Error('Сейчас ход другого участника');
  if (action.type === 'swap') {
    if (b.phase !== 'before') throw new Error('Разрешена одна перестановка за ход');
    const victim = target(b, actor, action.targetId);
    const result = resolveSwap(b.board, action.from, action.to, random);
    b.board = result.board;
    for (const e of elements) actor.energy[e] = Math.min(actor.stats.maxEnergy, actor.energy[e] + result.energy[e] * b.content.balance.energyPerTile);
    b.pendingMatch = result.count;
    addLog(b, `${actor.name}: собрано ${result.count} фишек, каскадов ${result.cascades}. Энергия: ${elements.filter(e => result.energy[e]).map(e => `${e} +${result.energy[e] * b.content.balance.energyPerTile}`).join(', ')}`);
    if (result.shuffled) addLog(b, 'Нет доступных ходов. Поле обновлено.');
    if (b.rule === 'on-match') { b.phase = 'choose'; return; }
    damage(b, actor, victim, result.count * b.content.balance.damagePerTile);
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
    const power = skill.power + (b.rule === 'on-match' ? b.pendingMatch * b.content.balance.damagePerTile : 0);
    addLog(b, `${actor.name} применяет «${skill.name}»`);
    if (skill.effect === 'damage') damage(b, actor, victim, power);
    else { const healed = Math.min(power, victim.stats.maxHp - victim.hp); victim.hp += healed; addLog(b, `${victim.name}: +${healed} HP`); }
    if (b.rule === 'on-match') nextTurn(b); else finishOrWave(b);
  } else if (action.type === 'item') {
    if (b.phase !== 'before' || b.usedSkill || b.rule === 'on-match') throw new Error('Зелье доступно до перестановки вместо навыка');
    const stack = actor.inventory.find(i => i.itemId === action.itemId && i.quantity > 0);
    const item = b.content.items.find(i => i.id === action.itemId);
    if (!stack || !item) throw new Error('Предмет недоступен');
    if (actor.hp === actor.stats.maxHp) throw new Error('Здоровье уже полное');
    stack.quantity--; const healed = Math.min(item.heal, actor.stats.maxHp - actor.hp); actor.hp += healed; b.usedSkill = true;
    addLog(b, `${actor.name}: ${item.name}, +${healed} HP`);
  } else {
    if (b.phase !== 'after') throw new Error('Сначала выполните перестановку и обязательный выбор навыка');
    nextTurn(b);
  }
}
export function runNpcTurns(b: Battle) {
  for (let n = 0; n < 10 && b.status === 'active'; n++) {
    const actor = b.fighters.find(f => f.id === b.activeId);
    if (!actor?.npc) return;
    let victim = b.fighters.find(f => f.hp > 0 && f.team !== actor.team)!;
    const chooseSkill = () => {
      const available = b.content.skills.filter(s => actor.skillIds.includes(s.id) && actor.energy[s.element] >= s.cost && !(actor.cooldowns[s.id] > 0));
      const heal = actor.hp <= actor.stats.maxHp / 2 ? available.filter(s => s.effect === 'heal').sort((a, c) => c.power - a.power)[0] : undefined;
      return heal ?? available.filter(s => s.effect === 'damage').sort((a, c) => c.power - a.power)[0];
    };
    const cast = () => { const s = chooseSkill(); if (!s) throw new Error('Противнику нужен базовый навык без затрат'); applyAction(b, actor.id, { type: 'skill', skillId: s.id, targetId: s.effect === 'heal' ? actor.id : victim.id }); };
    if (b.rule !== 'on-match') cast();
    if (b.status !== 'active' || b.activeId !== actor.id) continue;
    victim = b.fighters.find(f => f.hp > 0 && f.team !== actor.team)!;
    const move = possibleMove(b.board); if (!move) throw new Error('Нет доступного хода');
    applyAction(b, actor.id, { type: 'swap', ...move, targetId: victim.id });
    if (b.status !== 'active' || b.activeId !== actor.id) continue;
    if (b.phase === 'choose') cast();
    else if (b.phase === 'after') applyAction(b, actor.id, { type: 'end' });
  }
}
