import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, BattlefieldEngine, BattlefieldMoveResult, Content, TileType, applyAction, createBattlefield, createCharacter, defaultBattlefieldEngine, emptyEnergy, grantSkill, joinBattle, newBattle, runNpcTurns, seedContent, startBattle, tileTypes, skillEnergy } from '../src';

function duel(skills: string[] = []): Battle {
  const hero = createCharacter('hero', 'Герой', seedContent), enemy = createCharacter('enemy', 'Противник', seedContent);
  for (const id of skills) grantSkill(hero, id, seedContent);
  const battle = newBattle('battle', 'Новый бой', 'duel', 'on-match', hero, seedContent);
  joinBattle(battle, enemy, 1); startBattle(battle);
  return battle;
}
function engine(direct: Partial<Record<TileType, number>>, generated: Partial<Record<TileType, number>> = {}): BattlefieldEngine {
  const counts = (value: Partial<Record<TileType, number>>) => ({ count: Object.values(value).reduce<number>((sum, value) => sum + (value ?? 0), 0), byType: Object.fromEntries(tileTypes.map(type => [type, value[type] ?? 0])) });
  return { ...defaultBattlefieldEngine, move: field => {
    const first = counts(direct), secondary = counts(generated);
    const total = counts(Object.fromEntries(tileTypes.map(type => [type, (direct[type] ?? 0) + (generated[type] ?? 0)])));
    return { board: field.board.map(row => [...row]), config: structuredClone(field.config), direct: first, generated: secondary, total, cascades: secondary.count ? 1 : 0, steps: [{ source: 'direct', removed: first }, ...(secondary.count ? [{ source: 'generated' as const, removed: secondary }] : [])], shuffled: false, regeneration: null };
  } };
}
function swap(battle: Battle, direct: Partial<Record<TileType, number>>, generated: Partial<Record<TileType, number>> = {}) {
  applyAction(battle, battle.activeId!, { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: '' }, Math.random, engine(direct, generated));
}
function cast(battle: Battle, id = 'strike', targetId = 'enemy') {
  applyAction(battle, battle.activeId!, { type: 'skill', skillId: id, targetId });
}

test('a nonmatching swap spends exactly one turn without energy, guard, damage or skill choice', () => {
  const battle = duel(['ember']);
  battle.battlefield = { size: { rows: 3, cols: 3 }, elementTypes: ['fire', 'water', 'earth'] };
  battle.board = [['water', 'earth', 'water'], ['earth', 'fire', 'earth'], ['fire', 'water', 'fire']];
  battle.fighters[0].skillEnergy = 9;
  const before = structuredClone(battle);
  applyAction(battle, 'hero', { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: 'enemy' });
  assert.deepEqual(battle.board, [['earth', 'water', 'water'], ['earth', 'fire', 'earth'], ['fire', 'water', 'fire']]);
  assert.equal(battle.turn, before.turn + 1); assert.equal(battle.activeId, 'enemy');
  assert.equal(battle.phase, 'before'); assert.deepEqual(battle.skillChoices, []);
  assert.equal(skillEnergy(battle.fighters[0]), 9);
  assert.equal(battle.fighters[0].guardDefense ?? 0, before.fighters[0].guardDefense ?? 0);
  assert.deepEqual(battle.fighters.map(fighter => fighter.hp), before.fighters.map(fighter => fighter.hp));
  assert.equal(battle.pendingBattlefield, undefined); assert.equal(battle.matchPowerBps, undefined);
  assert.equal(battle.boardMoves?.length, 1); assert.equal(battle.boardMoves[0].total.count, 0);
  assert.deepEqual(battle.boardMoves[0].steps, []);
  assert.throws(() => applyAction(battle, 'hero', { type: 'skill', skillId: 'ember', targetId: 'enemy' }), /другого участника/);
});

test('an NPC can end its turn by rearranging a board with no matching moves', () => {
  const battle = duel();
  battle.activeId = 'enemy'; battle.fighters[1].npc = true;
  battle.battlefield = { size: { rows: 1, cols: 4 }, elementTypes: [...tileTypes] };
  battle.board = [['fire', 'water', 'earth', 'air']];
  runNpcTurns(battle);
  assert.equal(battle.activeId, 'hero'); assert.equal(battle.turn, 2);
  assert.deepEqual(battle.board, [['water', 'fire', 'earth', 'air']]);
  assert.equal(skillEnergy(battle.fighters[1]), 0); assert.equal(battle.boardMoves?.[0].total.count, 0);
});

test('all new templates start with only one physical skill, four unspent points and six field types', () => {
  for (const templateId of [undefined, ...seedContent.characterTemplates.map(template => template.id)]) {
    const character = createCharacter('hero', 'Герой', seedContent, templateId);
    assert.deepEqual(character.learnedSkillIds, ['strike']); assert.equal(character.skillPoints, 4);
    assert.deepEqual(character.skillLevels, { strike: 1 });
  }
  assert.deepEqual(createBattlefield().config.elementTypes, tileTypes);
  assert.equal(tileTypes.length, 6);
});

test('only direct energy is available when skills are chosen; cascades are awarded after casting', () => {
  const battle = duel(['ember', 'fireball', 'spring']);
  swap(battle, { fire: 3 }, { fire: 2, water: 3, physical: 4 });
  assert.equal(battle.phase, 'choose'); assert.equal(battle.activeId, 'hero');
  assert.equal(skillEnergy(battle.fighters[0]), 3);
  assert.deepEqual(battle.skillChoices?.map(choice => choice.skillId), ['ember', 'fireball']);
  assert.equal(battle.skillChoices?.find(choice => choice.skillId === 'fireball')?.enabled, false);
  assert.equal(battle.boardMoves?.[0].generated.count, 0);
  assert.ok(battle.pendingBattlefield);
  assert.equal(battle.fighters[1].hp, 120); // Neither direct nor secondary matches deal damage.
  cast(battle, 'ember');
  assert.equal(skillEnergy(battle.fighters[0]), 9);
  assert.equal(battle.fighters[1].hp, 105); // Base skill power + attack - defense.
  assert.equal(battle.pendingBattlefield, undefined);
  assert.equal(battle.boardMoves?.at(-1)?.continuation, true);
  assert.equal(battle.activeId, 'enemy');
});

test('unaffordable matching skills remain visible and energy can be preserved for a later turn', () => {
  const battle = duel(['fireball']);
  swap(battle, { fire: 3 });
  assert.deepEqual(battle.skillChoices, [{ skillId: 'fireball', enabled: false, reason: 'Недостаточно энергии' }]);
  const before = structuredClone(battle);
  assert.throws(() => cast(battle, 'fireball'), /энергии/); assert.deepEqual(battle, before);
  applyAction(battle, 'hero', { type: 'end' }); assert.equal(skillEnergy(battle.fighters[0]), 3);
  swap(battle, { water: 3 }); // Enemy has no water skill; its turn automatically ends.
  assert.equal(battle.activeId, 'hero');
  swap(battle, { fire: 3 });
  assert.equal(skillEnergy(battle.fighters[0]), 6); assert.equal(battle.skillChoices?.[0].enabled, true);
  cast(battle, 'fireball'); assert.equal(skillEnergy(battle.fighters[0]), 1);
});

test('unknown primary types and all secondary types only award energy, never unrelated skill choices', () => {
  const battle = duel();
  swap(battle, { water: 3 }, { physical: 5, defense: 4 });
  assert.equal(battle.activeId, 'enemy'); assert.equal(battle.phase, 'before');
  assert.deepEqual(battle.skillChoices, []);
  assert.equal(skillEnergy(battle.fighters[0]), 12);
  assert.equal(battle.fighters[0].guardDefense, 0); assert.equal(battle.fighters[1].hp, 120);
});

test('only matching types are visible even when other learned skills have enough saved energy', () => {
  const battle = duel(['ember', 'spring']); battle.fighters[0].skillEnergy = 30;
  swap(battle, { physical: 3, fire: 3 });
  assert.deepEqual(new Set(battle.skillChoices?.map(choice => choice.skillId)), new Set(['strike', 'ember']));
  assert.throws(() => cast(battle, 'spring', 'hero'), /Тип навыка/);
});

test('the shared energy pool is capped at 30 independently of legacy capacity stats', () => {
  const battle = duel(['ember']);
  const hero = battle.fighters[0]; hero.stats.maxEnergy = 100; hero.skillEnergy = 29;
  swap(battle, { fire: 3 }, { fire: 50, water: 50, air: 40, defense: 40 });
  assert.equal(skillEnergy(hero), 30);
  assert.equal(hero.guardDefense, 0);
  assert.ok(Object.values(hero.energy).every(value => value <= 30));
});

test('direct defense creates a proportional guard, secondary defense gives only energy, guard expires on own turn', () => {
  const battle = duel(), hero = battle.fighters[0];
  swap(battle, { defense: 3 }, { defense: 4, physical: 2 });
  assert.equal(hero.guardDefense, 30); assert.equal(skillEnergy(hero), 6);
  assert.equal(hero.stats.defense, 3); assert.equal(battle.activeId, 'enemy');
  swap(battle, { physical: 3 }); cast(battle, 'strike', 'hero');
  assert.equal(hero.hp, 119); assert.equal(hero.guardDefense, 0); assert.equal(hero.stats.defense, 3);
});

test('guard survives all intervening opposing team turns rather than being consumed by the first hit', () => {
  const hero = createCharacter('hero', 'Герой', seedContent);
  const battle = newBattle('team', 'Команды', 'team', 'on-match', hero, seedContent);
  for (const [id, team] of [['ally', 0], ['enemy', 1], ['enemy2', 1]] as const) joinBattle(battle, createCharacter(id, id, seedContent), team);
  startBattle(battle); swap(battle, { defense: 3 });
  swap(battle, { physical: 3 }); cast(battle, 'strike', 'hero');
  assert.equal(battle.activeId, 'ally'); assert.equal(battle.fighters[0].guardDefense, 30);
  swap(battle, { water: 3 });
  assert.equal(battle.activeId, 'enemy2'); swap(battle, { physical: 3 }); cast(battle, 'strike', 'hero');
  assert.equal(battle.activeId, 'hero'); assert.equal(battle.fighters[0].hp, 118); assert.equal(battle.fighters[0].guardDefense, 0);
});

test('a mixed defense/physical match gives guard and a skill choice without converting direct defense to energy', () => {
  const battle = duel(); swap(battle, { defense: 3, physical: 3 });
  assert.equal(battle.fighters[0].guardDefense, 30); assert.equal(skillEnergy(battle.fighters[0]), 3);
  assert.deepEqual(battle.skillChoices, [{ skillId: 'strike', enabled: true }]);
  cast(battle); assert.equal(battle.fighters[0].guardDefense, 30); assert.equal(skillEnergy(battle.fighters[0]), 0);
});

test('skills cannot precede a swap, repeat a swap, target an invalid fighter or bypass cooldowns', () => {
  const battle = duel(['fireball']), hero = battle.fighters[0]; hero.skillEnergy = 30;
  assert.throws(() => cast(battle, 'fireball'), /Сначала совместите/);
  assert.throws(() => applyAction(battle, 'hero', { type: 'end' }), /перестановку/);
  hero.cooldowns.fireball = 2; swap(battle, { fire: 3 });
  assert.deepEqual(battle.skillChoices, [{ skillId: 'fireball', enabled: false, reason: 'Навык перезаряжается' }]);
  const before = structuredClone(battle);
  assert.throws(() => swap(battle, { fire: 3 }), /одна перестановка/);
  assert.throws(() => cast(battle, 'fireball'), /перезаряжается/); assert.deepEqual(battle, before);
  hero.cooldowns.fireball = 0;
  assert.throws(() => cast(battle, 'fireball', 'hero'), /противника/); assert.equal(skillEnergy(hero), 30);
});

test('healing is restricted to directly matched types, costs energy and receives no cascade power bonus', () => {
  const battle = duel(['spring']); battle.fighters[0].hp = 60;
  swap(battle, { water: 3 }, { water: 20 });
  cast(battle, 'spring', 'hero');
  assert.equal(battle.fighters[0].hp, 72); assert.equal(skillEnergy(battle.fighters[0]), 20);
});

test('a potion before the board replaces the skill without replacing the mandatory board move', () => {
  const battle = duel(); battle.fighters[0].hp = 100;
  applyAction(battle, 'hero', { type: 'item', itemId: 'potion' });
  assert.equal(battle.fighters[0].hp, 120); assert.equal(battle.activeId, 'hero');
  assert.throws(() => applyAction(battle, 'hero', { type: 'end' }), /перестановку/);
  swap(battle, { physical: 3 }); assert.equal(battle.activeId, 'enemy'); assert.equal(skillEnergy(battle.fighters[0]), 3);
});

test('NPC follows the same board-first rules and cannot attack from a secondary-only physical match', () => {
  const battle = newBattle('bot', 'Бот', 'bot', 'on-match', createCharacter('hero', 'Герой', seedContent), seedContent); startBattle(battle);
  swap(battle, { water: 3 }); assert.equal(battle.activeId, 'bot-opponent');
  runNpcTurns(battle, engine({ water: 3 }, { physical: 5, defense: 2 }));
  assert.equal(battle.activeId, 'hero'); assert.equal(battle.fighters[0].hp, 120);
  assert.equal(skillEnergy(battle.fighters[1]), 10);
  swap(battle, { water: 3 });
  runNpcTurns(battle, engine({ physical: 3 }));
  assert.equal(battle.activeId, 'hero'); assert.equal(battle.fighters[0].hp, 110);
});

test('all thirty learned skills obey direct type selection, energy spending and their own power', () => {
  for (const skill of seedContent.skills) {
    const battle = duel(seedContent.skills.filter(skill => !skill.learning.starter).map(skill => skill.id));
    const hero = battle.fighters[0], enemy = battle.fighters[1];
    hero.skillEnergy = 30;
    const victim = skill.effect === 'heal' ? hero : enemy;
    victim.hp = skill.effect === 'heal' ? 1 : victim.stats.maxHp;
    const hp = victim.hp;
    swap(battle, { [skill.element]: 3 }, { [skill.element]: 9, defense: 5 });
    assert.ok(battle.skillChoices?.some(choice => choice.skillId === skill.id && choice.enabled), skill.id);
    assert.ok(battle.skillChoices?.every(choice => seedContent.skills.find(skill => skill.id === choice.skillId)?.element === skill.element));
    cast(battle, skill.id, victim.id);
    assert.equal(skillEnergy(hero), Math.min(30, 30 - skill.cost + 14), skill.id);
    assert.equal(victim.hp, skill.effect === 'heal' ? Math.min(victim.stats.maxHp, hp + skill.power) : Math.max(0, hp - Math.max(1, skill.power + hero.stats.attack - victim.stats.defense)), skill.id);
    assert.equal(battle.activeId, 'enemy', skill.id);
  }
});


test('energy saved from a different type and secondary defense pays for a directly matched skill', () => {
  const battle = duel(['fireball']);
  swap(battle, { water: 3 }, { defense: 2 });
  assert.equal(skillEnergy(battle.fighters[0]), 5);
  swap(battle, { water: 3 });
  swap(battle, { fire: 3 });
  assert.equal(battle.skillChoices?.find(choice => choice.skillId === 'fireball')?.enabled, true);
  cast(battle, 'fireball');
  assert.equal(skillEnergy(battle.fighters[0]), 3);
});

test('typed template reserves initialize a capped shared reserve once', () => {
  const battle = duel(['fireball']), hero = battle.fighters[0];
  delete hero.skillEnergy;
  hero.energy.water = 20; hero.energy.air = 20;
  assert.equal(skillEnergy(hero), 30);
  swap(battle, { fire: 3 }); cast(battle, 'fireball');
  assert.equal(skillEnergy(hero), 25);
  assert.equal(hero.energy.water, 20); // Legacy data does not refill the explicit reserve.
});

test('direct cell count scales skill power by 0.3 per cell beyond three, cascades do not', () => {
  for (const count of [3, 4, 5, 6]) {
    const battle = duel(), [hero, enemy] = battle.fighters;
    swap(battle, { physical: count }, { physical: 20 });
    assert.equal(battle.matchPowerBps, 10000 + (count - 3) * 3000);
    assert.equal(skillEnergy(hero), count);
    cast(battle);
    assert.equal(enemy.hp, 120 - Math.floor(5 * (1 + (count - 3) * 0.3) + 8 - 3));
    assert.equal(skillEnergy(hero), count - 3 + 20);
    assert.equal(battle.matchPowerBps, undefined);
  }
});

test('a saved pending cascade survives reload, invalid casts and is credited only once on skipping', () => {
  const battle = duel(['fireball']);
  swap(battle, { fire: 3 }, { defense: 8 });
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  assert.equal(skillEnergy(restored.fighters[0]), 3);
  assert.throws(() => cast(restored, 'fireball'), /энергии/);
  assert.deepEqual(restored, JSON.parse(JSON.stringify(battle)));
  applyAction(restored, 'hero', { type: 'end' });
  assert.equal(skillEnergy(restored.fighters[0]), 11);
  assert.equal(restored.pendingBattlefield, undefined);
  assert.throws(() => applyAction(restored, 'hero', { type: 'end' }), /другого участника/);
  assert.equal(skillEnergy(restored.fighters[0]), 11);
});

test('casting frees capacity before secondary energy is capped', () => {
  const battle = duel(['fireball']); battle.fighters[0].skillEnergy = 28;
  swap(battle, { fire: 3 }, { water: 3 });
  assert.equal(skillEnergy(battle.fighters[0]), 30);
  cast(battle, 'fireball');
  assert.equal(skillEnergy(battle.fighters[0]), 28);
});

test('the visible board pauses after the direct refill and resumes its saved result without another field call', () => {
  const battle = duel(), staged = engine({ physical: 4 }, { defense: 3 });
  const directBoard = battle.board.map(row => [...row]), finalBoard = battle.board.map(row => [...row]);
  directBoard[0][0] = 'fire'; finalBoard[0][0] = 'water';
  let calls = 0;
  const field: BattlefieldEngine = { ...staged, move: (...args) => {
    calls++;
    const result = staged.move(...args);
    result.board = finalBoard; result.steps[0].boardAfter = directBoard; result.steps[1].boardAfter = finalBoard;
    return result;
  } };
  applyAction(battle, 'hero', { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: '' }, Math.random, field);
  assert.deepEqual(battle.board, directBoard);
  assert.deepEqual(battle.boardMoves?.[0].steps.map(step => step.source), ['direct']);
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  let checkpoint = false;
  applyAction(restored, 'hero', { type: 'skill', skillId: 'strike', targetId: 'enemy' }, () => { throw new Error('RNG must not be repeated'); }, field, frame => {
    checkpoint = true;
    assert.deepEqual(frame.board, directBoard);
    assert.equal(frame.fighters[0].skillEnergy, 1);
    assert.ok(frame.fighters[1].hp < 120);
  });
  assert.ok(checkpoint); assert.equal(calls, 1);
  assert.deepEqual(restored.board, finalBoard);
  assert.equal(restored.fighters[0].skillEnergy, 4);
});

test('NPC cannot spend energy from its pending cascades', () => {
  const hero = createCharacter('hero', 'Герой', seedContent); grantSkill(hero, 'fireball', seedContent);
  const battle = newBattle('bot', 'Бот', 'bot', 'on-match', hero, seedContent); startBattle(battle);
  swap(battle, { water: 3 });
  runNpcTurns(battle, engine({ fire: 3 }, { fire: 10 }));
  assert.equal(battle.fighters[0].hp, 120);
  assert.equal(skillEnergy(battle.fighters[1]), 13);
  assert.equal(battle.pendingBattlefield, undefined);
});
