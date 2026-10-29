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

test('all new templates start with only one physical skill, four unspent points and six field types', () => {
  for (const templateId of [undefined, ...seedContent.characterTemplates.map(template => template.id)]) {
    const character = createCharacter('hero', 'Герой', seedContent, templateId);
    assert.deepEqual(character.learnedSkillIds, ['strike']); assert.equal(character.skillPoints, 4);
    assert.deepEqual(character.skillLevels, { strike: 1 });
  }
  assert.deepEqual(createBattlefield().config.elementTypes, tileTypes);
  assert.equal(tileTypes.length, 6);
});

test('only direct types offer skills and all cascades award energy before the choices are computed', () => {
  const battle = duel(['ember', 'fireball', 'spring']);
  swap(battle, { fire: 3 }, { fire: 2, water: 3, physical: 4 });
  assert.equal(battle.phase, 'choose'); assert.equal(battle.activeId, 'hero');
  assert.equal(skillEnergy(battle.fighters[0]), 12);
  assert.deepEqual(battle.skillChoices?.map(choice => choice.skillId), ['ember', 'fireball']);
  assert.ok(battle.skillChoices?.every(choice => choice.enabled));
  assert.equal(battle.fighters[1].hp, 120); // Neither direct nor secondary matches deal damage.
  cast(battle, 'fireball');
  assert.equal(skillEnergy(battle.fighters[0]), 7);
  assert.equal(battle.fighters[1].hp, 91); // 24 power + 8 attack - 3 defense; no tile damage bonus.
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
  assert.equal(battle.fighters[0].hp, 72); assert.equal(skillEnergy(battle.fighters[0]), 21);
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
    assert.equal(skillEnergy(hero), 30 - skill.cost, skill.id);
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

test('older v2 typed reserves convert once into a capped shared reserve', () => {
  const battle = duel(['fireball']), hero = battle.fighters[0];
  delete hero.skillEnergy;
  hero.energy.water = 20; hero.energy.air = 20;
  assert.equal(skillEnergy(hero), 30);
  swap(battle, { fire: 3 }); cast(battle, 'fireball');
  assert.equal(skillEnergy(hero), 25);
  assert.equal(hero.energy.water, 20); // Legacy data does not refill the explicit reserve.
});
