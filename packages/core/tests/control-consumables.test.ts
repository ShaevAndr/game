import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, applySkillEffects, applyCraftRecipe, backpackStacks, canMergeInstances, characterFighter,
  combatStatDefinitions, contentSchema, createCharacter, defaultCombatFormulaRules, joinBattle,
  newBattle, previewSkillEffects, runNpcTurns, seedContent, seedEffectSkills, startBattle,
  skillMagnitude, type Battle, type Content, type InventoryState, type Skill, type StunEffect,
} from '../src';
import { nextTurn } from '../src/combat/common';
import { fieldWithMatch } from './helpers/combat';

function catalog(): Content {
  return structuredClone({ ...seedContent, effectsVersion: 1, modifierRulesVersion: 1,
    statDefinitions: combatStatDefinitions, skills: [...seedContent.skills, ...seedEffectSkills],
    balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules } });
}
function fixture() {
  const content = catalog(), hero = createCharacter('hero', 'Герой', content), enemy = createCharacter('enemy', 'Враг', content);
  hero.learnedSkillIds = content.skills.map(skill => skill.id);
  hero.skillLevels = Object.fromEntries(hero.learnedSkillIds.map(id => [id, 1]));
  const battle = newBattle('control', 'Контроль', 'duel', 'on-match', hero, content);
  joinBattle(battle, enemy, 1); startBattle(battle); battle.attributeRngState = 0;
  return battle;
}
function guaranteed(battle: Battle): Skill {
  const skill = battle.content.skills.find(skill => skill.id === 'frost-lock')!;
  Object.assign(skill.effects![0], { activationChanceBps: 10000, maxChanceBps: 10000, chancePerSkillRankBps: 0 });
  return skill;
}
function ready(battle: Battle, skill: Skill) {
  battle.phase = 'choose'; battle.matchedElements = [skill.element];
  battle.fighters.find(fighter => fighter.id === battle.activeId)!.skillEnergy = 30;
}

test('v1 catalog validates control and consumable effects and keeps cheap damage at three energy', () => {
  assert.ok(contentSchema.safeParse(catalog()).success);
  for (const skill of seedContent.skills.filter(skill => skill.effect === 'damage')) assert.ok(skill.cost >= 3);
  const invalid = catalog(); (invalid.skills.find(skill => skill.id === 'frost-lock')!.effects![0] as StunEffect).durationTurns = 0;
  assert.equal(contentSchema.safeParse(invalid).success, false);
  const invalidPotion = catalog(); invalidPotion.items.find(item => item.id === 'potion')!.effects = [{ ...guaranteed(fixture()).effects![0]!, recipient: 'caster' }];
  assert.equal(contentSchema.safeParse(invalidPotion).success, false);
});

test('stun automatically skips one full turn: no board or energy, guard expires, cooldown advances', () => {
  const battle = fixture(), skill = guaranteed(battle), before = structuredClone(battle.board);
  battle.fighters[1].cooldowns.strike = 2; battle.fighters[1].guardDefense = 30;
  ready(battle, skill);
  applyAction(battle, 'hero', { type: 'skill', skillId: skill.id, targetId: 'enemy' });
  assert.equal(battle.activeId, 'hero'); assert.equal(battle.turn, 3);
  assert.equal(battle.fighters[1].skillEnergy, 0); assert.equal(battle.fighters[1].guardDefense, 0);
  assert.equal(battle.fighters[1].cooldowns.strike, 1); assert.equal(battle.fighters[1].turnsStarted, 1);
  assert.deepEqual(battle.board, before); assert.deepEqual(battle.boardMoves, []);
  assert.equal(battle.fighters[1].activeEffects!.length, 0);
  assert.ok(battle.log.some(line => /пропускает ход/.test(line)));
});

test('stun snapshot survives JSON recovery, and all stunned fighters eventually get another action', () => {
  const battle = fixture(), skill = guaranteed(battle), [hero, enemy] = battle.fighters;
  applySkillEffects(battle, hero, skill, enemy.id);
  applySkillEffects(battle, enemy, skill, hero.id);
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  nextTurn(battle); nextTurn(restored);
  assert.deepEqual(restored, battle);
  assert.equal(battle.activeId, 'enemy'); assert.equal(battle.turn, 4);
  assert.ok(battle.fighters.every(fighter => !fighter.activeEffects?.some(effect => effect.kind === 'stun')));
});

test('a stunned actor cannot forge a board, potion or skill command', () => {
  const battle = fixture(), skill = guaranteed(battle);
  applySkillEffects(battle, battle.fighters[1], skill, 'hero');
  const before = structuredClone(battle);
  assert.throws(() => applyAction(battle, 'hero', { type: 'item', itemId: 'potion' }), /оглушён/);
  assert.throws(() => applyAction(battle, 'hero', { type: 'end' }), /оглушён/);
  assert.deepEqual(battle, before);
});

test('damage, stun chance and duration progress independently; match size never boosts chance or duration', () => {
  const battle = fixture(), actor = battle.fighters[0];
  const hit = battle.content.skills.find(skill => skill.id === 'concussive-blow')!;
  const first = previewSkillEffects(battle, actor, hit);
  actor.skillLevels![hit.id] = 10; battle.matchPowerBps = 19000;
  const last = previewSkillEffects(battle, actor, hit);
  assert.ok(last.find(effect => effect.kind === 'damage')!.magnitude! > first.find(effect => effect.kind === 'damage')!.magnitude!);
  assert.equal(last.find(effect => effect.kind === 'stun')!.activationChanceBps, 5000);
  assert.equal(last.find(effect => effect.kind === 'stun')!.durationTurns, 1);
  const frost = battle.content.skills.find(skill => skill.id === 'frost-lock')!;
  assert.equal(previewSkillEffects(battle, actor, frost)[0].activationChanceBps, 6500);
  actor.skillLevels![frost.id] = 10;
  assert.equal(previewSkillEffects(battle, actor, frost)[0].activationChanceBps, 8000);
});

test('zero-chance stun consumes the skill normally and lets the opponent act', () => {
  const battle = fixture(), skill = guaranteed(battle);
  Object.assign(skill.effects![0], { activationChanceBps: 0, maxChanceBps: 0 }); ready(battle, skill);
  applyAction(battle, 'hero', { type: 'skill', skillId: skill.id, targetId: 'enemy' });
  assert.equal(battle.activeId, 'enemy'); assert.equal(battle.fighters[0].skillEnergy, 25);
  assert.equal(battle.effectResults![0].outcome, 'chance_failed');
});

test('crafted potion preserves its concrete effects through reload and later catalog edits', () => {
  const content = catalog(), state: InventoryState = { ownerId: 'hero', inventories: [{ id: 'hero', ownerId: 'hero', name: 'Рюкзак', primary: true, capacity: 50 }],
    items: [{ id: 'herb', itemId: 'healing-herb', ownerId: 'hero', inventoryId: 'hero', quantity: 10, equippedSlot: null }] };
  const crafted = applyCraftRecipe(state, content.recipes!.find(recipe => recipe.id === 'brew-potion')!, content.items, () => 'bottle');
  const restored: InventoryState = JSON.parse(JSON.stringify(crafted.state));
  const bottle = restored.items.find(item => item.id === 'bottle')!;
  assert.equal(bottle.effects![0].kind, 'heal');
  content.items.find(item => item.id === 'potion')!.effects![0] = { id: 'heal', kind: 'heal', recipient: 'caster', magnitude: { unit: 'hp', constant: 999, min: 0 } };
  assert.equal(canMergeInstances(bottle, { ...bottle, id: 'other', effects: content.items.find(item => item.id === 'potion')!.effects }, 99), false);
  const hero = createCharacter('hero', 'Герой', content); hero.inventory = backpackStacks(restored);
  const battle = newBattle('potion', 'Зелье', 'bot', 'on-match', hero, content); startBattle(battle);
  battle.fighters[0].hp = 30;
  applyAction(battle, 'hero', { type: 'item', itemId: 'potion' });
  assert.equal(battle.fighters[0].hp, 65); assert.equal(battle.usedSkill, true); assert.equal(battle.phase, 'before');
  assert.equal(battle.effectResults![0].sourceItemId, 'potion'); assert.equal(battle.effectResults![0].sourceSkillId, undefined);
});

test('cleansing potion and an ally can dispel stun before its next eligible turn', () => {
  const battle = fixture(), skill = guaranteed(battle), [hero, enemy] = battle.fighters;
  applySkillEffects(battle, enemy, skill, hero.id);
  const purify = battle.content.skills.find(skill => skill.id === 'purify')!;
  const ally = characterFighter(createCharacter('ally', 'Союзник', battle.content), 0, battle.content);
  battle.fighters.push(ally);
  applySkillEffects(battle, ally, purify, hero.id);
  assert.equal(hero.activeEffects!.length, 0);
  const debuff = battle.content.skills.find(skill => skill.id === 'weakening')!;
  applySkillEffects(battle, enemy, debuff, hero.id);
  applyAction(battle, hero.id, { type: 'item', itemId: 'cleansing-potion' });
  assert.equal(battle.fighters[0].activeEffects!.length, 0);
  assert.equal(battle.fighters[0].hp, 120);
});


test('group abilities trade single-target efficiency for useful totals on three recipients', () => {
  const battle = fixture(), actor = battle.fighters[0];
  for (const rank of [1, 10]) {
    for (const [groupId, singleId] of [['meteor-shower', 'fireball'], ['healing-rain', 'tide']]) {
      const group = battle.content.skills.find(skill => skill.id === groupId)!, single = battle.content.skills.find(skill => skill.id === singleId)!;
      actor.skillLevels![groupId] = rank;
      const perTarget = previewSkillEffects(battle, actor, group)[0].magnitude!;
      const focused = skillMagnitude(single, rank, actor.attributes!.effective);
      assert.ok(perTarget < focused);
      assert.ok(perTarget * 3 / group.cost >= focused / single.cost * 0.9);
    }
  }
});

test('a full-health buff potion uses the same effect executor with an item source and no tile multiplier', () => {
  const battle = fixture(); battle.matchPowerBps = 19000;
  const effects: NonNullable<Content['items'][number]['effects']> = [{ id: 'power', recipient: 'caster', kind: 'stat_modifier', polarity: 'buff',
    statId: 'physicalPower', operation: 'add_flat', magnitude: { unit: 'points', constant: 5 }, durationTurns: 2 }];
  battle.content.items.push({ id: 'tonic-test', name: 'Настой', description: '', groupId: 'potions', stackLimit: 99, effects });
  battle.fighters[0].inventory.push({ itemId: 'tonic-test', quantity: 1, effects: structuredClone(effects) });
  const before = battle.fighters[0].attributes!.effective.physicalPower;
  applyAction(battle, 'hero', { type: 'item', itemId: 'tonic-test' });
  const actor = battle.fighters[0];
  assert.equal(actor.attributes!.effective.physicalPower, before + 5);
  assert.equal(actor.activeEffects![0].sourceItemId, 'tonic-test');
  assert.equal(actor.activeEffects![0].sourceSkillId, undefined);
  assert.equal(actor.activeEffects![0].remainingTurns, 2);
});

test('a bad later potion effect rolls back healing, quantity, action and the random stream', () => {
  const battle = fixture(); battle.fighters[0].hp = 30;
  const effects: NonNullable<Content['items'][number]['effects']> = [
    { id: 'heal', recipient: 'caster', kind: 'heal', magnitude: { unit: 'hp', constant: 35, min: 0 } },
    { id: 'invalid', recipient: 'caster', kind: 'stat_modifier', polarity: 'buff', activationChanceBps: 9999,
      statId: 'unknown', operation: 'add_flat', magnitude: { unit: 'points', constant: 5 }, durationTurns: 2 },
  ];
  battle.content.items.push({ id: 'bad-tonic', name: 'Некорректный настой', description: '', groupId: 'potions', stackLimit: 99, effects });
  battle.fighters[0].inventory.push({ itemId: 'bad-tonic', quantity: 1, effects });
  const before = structuredClone(battle);
  assert.throws(() => applyAction(battle, 'hero', { type: 'item', itemId: 'bad-tonic' }), /характеристик/);
  assert.deepEqual(battle, before);
});

test('an excessive automatic stun chain fails instead of leaving a battle stuck on an NPC', () => {
  const content = catalog(), control = content.skills.find(skill => skill.id === 'frost-lock')!;
  control.cost = 3; control.cooldown = 0;
  Object.assign(control.effects![0], { activationChanceBps: 10000, maxChanceBps: 10000, chancePerSkillRankBps: 0 });
  const hero = createCharacter('hero', 'Герой', content); hero.learnedSkillIds.push(control.id);
  const battle = newBattle('chain', 'Цепочка контроля', 'bot', 'on-match', hero, content); startBattle(battle);
  const bot = battle.fighters[1]; bot.skillIds = [control.id]; battle.activeId = bot.id;
  assert.throws(() => runNpcTurns(battle, fieldWithMatch('water')), /предел автоматических ходов/);
});
