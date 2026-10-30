import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applySkillEffects, contentSchema, createCharacter, defaultStatDefinitions, joinBattle, legalSkillTargets, newBattle, projectCharacterAttributes,
  removeDeadEffects, runNpcTurns, seedContent, seedEffectSkills, skillChoices, startBattle, type Battle, type Content, type Skill, type StatModifierEffect } from '../src';

const content: Content = { ...seedContent, statDefinitions: defaultStatDefinitions, effectsVersion: 1, skills: [...seedContent.skills, ...seedEffectSkills] };
function fixture(extra: Skill[] = []) {
  const catalog = structuredClone(content); catalog.skills.push(...extra);
  const hero = (id: string) => {
    const character = createCharacter(id, id, catalog);
    character.baseAttributes!.luck = 0;
    character.learnedSkillIds = catalog.skills.map(skill => skill.id);
    character.skillLevels = Object.fromEntries(catalog.skills.map(skill => [skill.id, 1]));
    return projectCharacterAttributes(character, catalog);
  };
  const first = hero('first'), second = hero('second');
  const battle = newBattle('effects-battle', 'Эффекты', 'duel', 'on-match', first, catalog);
  joinBattle(battle, second, 1); startBattle(battle);
  return { battle, first, second };
}
const skill = (id: string) => structuredClone(seedEffectSkills.find(skill => skill.id === id)!);
function ready(battle: Battle, skillId: string) {
  const actor = battle.fighters.find(fighter => fighter.id === battle.activeId)!;
  actor.skillEnergy = 30; actor.cooldowns[skillId] = 0; battle.usedSkill = false;
  battle.phase = 'choose'; battle.matchedElements = [battle.content.skills.find(skill => skill.id === skillId)!.element];
}
function cast(battle: Battle, skillId: string, targetId: string) {
  ready(battle, skillId); applyAction(battle, battle.activeId!, { type: 'skill', skillId, targetId });
}
function pass(battle: Battle) { battle.phase = 'choose'; applyAction(battle, battle.activeId!, { type: 'end' }); }

test('seed effect skills form valid content and remain learnable, non-starter skills', () => {
  assert.equal(contentSchema.safeParse(content).success, true);
  assert.equal(seedEffectSkills.length, 7);
  assert.ok(seedEffectSkills.every(skill => !skill.learning.starter && skill.effects?.length && skill.targeting));
});

test('a self buff applies now, survives the current turn and expires after two subsequent owner turns', () => {
  const { battle, first } = fixture();
  cast(battle, 'battle-cry', first.id);
  let fighter = battle.fighters[0];
  assert.equal(fighter.attributes!.effective.strength, 12);
  assert.equal(fighter.activeEffects![0].remainingTurns, 2);
  assert.equal(fighter.activeEffects![0].eligibleFromTurn, 2);
  assert.equal(fighter.skillEnergy, 27);
  assert.equal(first.baseAttributes!.strength, 10);
  pass(battle); // enemy ends; first subsequent own turn starts
  assert.equal(battle.fighters[0].activeEffects![0].remainingTurns, 2);
  pass(battle); // first own turn ends
  assert.equal(battle.fighters[0].activeEffects![0].remainingTurns, 1);
  pass(battle); pass(battle); // second own turn ends
  fighter = battle.fighters[0];
  assert.equal(fighter.activeEffects!.length, 0);
  assert.equal(fighter.attributes!.effective.strength, 10);
  assert.equal(fighter.attributes!.effective.physicalPower, 8);
});

test('a debuff counts target turns, persists through JSON round trips and does not affect the caster', () => {
  const { battle, second } = fixture();
  cast(battle, 'weakening', second.id);
  assert.equal(battle.fighters[1].attributes!.effective.physicalPower, 6);
  assert.equal(battle.fighters[0].attributes!.effective.physicalPower, 8);
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  pass(battle); pass(restored);
  assert.equal(battle.fighters[1].activeEffects![0].remainingTurns, 1);
  pass(battle); pass(restored); pass(battle); pass(restored);
  assert.deepEqual(restored, battle);
  assert.equal(battle.fighters[1].activeEffects!.length, 0);
  assert.equal(battle.fighters[1].attributes!.effective.physicalPower, 8);
});

test('refresh replaces the snapshot and duration; changing source attributes later does not change magnitude', () => {
  const { battle } = fixture(), actor = battle.fighters[0], target = battle.fighters[1];
  const weakening = skill('weakening');
  applySkillEffects(battle, actor, weakening, target.id);
  const original = target.activeEffects![0]; original.remainingTurns = 1;
  actor.skillLevels!.weakening = 2;
  applySkillEffects(battle, actor, weakening, target.id);
  assert.equal(target.activeEffects!.length, 1);
  assert.equal(target.activeEffects![0].magnitude, -2100);
  assert.equal(target.activeEffects![0].remainingTurns, 2);
  assert.notEqual(target.activeEffects![0].instanceId, original.instanceId);
  actor.attributes!.effective.intelligence = 100;
  assert.equal(target.activeEffects![0].magnitude, -2100);
});

test('stronger replacement, bounded stacks and independent effects follow their declared rules', () => {
  for (const stacking of ['replace_if_stronger', 'stack', 'independent'] as const) {
    const { battle } = fixture(), [actor, target] = battle.fighters;
    const weakening = skill('weakening'), effect = weakening.effects![0] as StatModifierEffect;
    effect.stacking = stacking; effect.maxStacks = 2;
    applySkillEffects(battle, actor, weakening, target.id);
    const firstId = target.activeEffects![0].instanceId;
    if (stacking === 'replace_if_stronger') {
      target.activeEffects![0].remainingTurns = 1;
      effect.magnitude = { unit: 'basis_points', constant: -1000 };
      applySkillEffects(battle, actor, weakening, target.id);
      assert.equal(target.activeEffects![0].remainingTurns, 1);
      assert.equal(target.activeEffects![0].instanceId, firstId);
      effect.magnitude.constant = -3000;
      applySkillEffects(battle, actor, weakening, target.id);
      assert.equal(target.activeEffects![0].magnitude, -3000);
      assert.equal(target.activeEffects![0].remainingTurns, 2);
    } else {
      applySkillEffects(battle, actor, weakening, target.id); applySkillEffects(battle, actor, weakening, target.id);
      assert.equal(target.activeEffects!.length, stacking === 'stack' ? 1 : 2);
      if (stacking === 'stack') assert.equal(target.activeEffects![0].stacks, 2);
      else assert.ok(target.activeEffects!.every(effect => effect.instanceId !== firstId));
      assert.equal(target.attributes!.effective.physicalPower, 4);
    }
  }
});

test('cleansing removes only the oldest dispellable debuff and restores its contribution', () => {
  const { battle } = fixture(), [actor, target] = battle.fighters;
  applySkillEffects(battle, actor, skill('weakening'), target.id);
  applySkillEffects(battle, actor, skill('fire-vulnerability'), target.id);
  applySkillEffects(battle, target, skill('battle-cry'), target.id);
  const permanent = skill('weakening'); permanent.id = 'undispellable';
  const effect = permanent.effects![0] as StatModifierEffect; effect.stackKey = 'undispellable'; effect.dispellable = false;
  applySkillEffects(battle, actor, permanent, target.id);
  applySkillEffects(battle, target, skill('purify'), target.id);
  assert.equal(target.activeEffects!.length, 3);
  assert.ok(!target.activeEffects!.some(effect => effect.sourceSkillId === 'weakening'));
  assert.ok(target.activeEffects!.some(effect => effect.sourceSkillId === 'battle-cry'));
  assert.ok(target.activeEffects!.some(effect => !effect.dispellable));
  applySkillEffects(battle, target, skill('purify'), target.id);
  assert.equal(target.activeEffects!.length, 2);
});

test('composed casts snapshot magnitudes, but use resistance after earlier debuffs', () => {
  const combo = skill('rending-strike');
  const buff = (skill('battle-cry').effects![0] as StatModifierEffect); buff.recipient = 'caster';
  combo.effects!.unshift(buff);
  const { battle, second } = fixture([ { ...combo, id: 'test-combo' } ]);
  cast(battle, 'test-combo', second.id);
  assert.equal(battle.fighters[0].attributes!.effective.strength, 12);
  // Pre-cast power 8 × 1.5 = 12, target defense after -25% is 2 => 10 HP.
  assert.equal(battle.fighters[1].hp, 110);
  assert.equal(battle.fighters[1].attributes!.effective.physicalResistance, 2);
});

test('invalid targets and effect-limit failures leave energy, cooldowns, RNG and effects unchanged', () => {
  const { battle, first } = fixture();
  ready(battle, 'weakening'); let before = structuredClone(battle);
  assert.throws(() => applyAction(battle, first.id, { type: 'skill', skillId: 'weakening', targetId: first.id }), /цель/);
  assert.deepEqual(battle, before);
  const weak = skill('weakening');
  for (let index = 0; index < 64; index++) {
    (weak.effects![0] as StatModifierEffect).stackKey = `capacity-${index}`;
    applySkillEffects(battle, battle.fighters[0], weak, battle.fighters[1].id);
  }
  ready(battle, 'fire-vulnerability'); before = structuredClone(battle);
  assert.throws(() => applyAction(battle, first.id, { type: 'skill', skillId: 'fire-vulnerability', targetId: battle.fighters[1].id }), /лимит/);
  assert.deepEqual(battle, before);
});

test('ally-only skills stay visible but unavailable with no legal target; self and groups resolve correctly', () => {
  const support = skill('battle-cry'); support.id = 'ally-only'; support.targeting = { kind: 'ally_single', includeSelf: false };
  const { battle, first } = fixture([support]);
  ready(battle, support.id);
  const choice = skillChoices(battle, battle.fighters[0]).find(choice => choice.skillId === support.id)!;
  assert.equal(choice.enabled, false); assert.deepEqual(choice.targetIds, []); assert.match(choice.reason!, /цели/);
  assert.equal(legalSkillTargets(battle, battle.fighters[0], skill('stone-skin'))[0].id, first.id);
  const group = skill('battle-cry'); group.targeting = { kind: 'allies_all' };
  assert.deepEqual(legalSkillTargets(battle, battle.fighters[0], group).map(target => target.id), [first.id]);
});

test('maximum-HP buffs do not heal; expiry clamps HP; dead sources do not remove effects on others', () => {
  const { battle } = fixture(), [actor, target] = battle.fighters;
  const health = skill('battle-cry'), definition = health.effects![0] as StatModifierEffect;
  health.targeting = { kind: 'enemy_single' };
  definition.statId = 'maxHp'; definition.magnitude = { unit: 'basis_points', constant: 10000 };
  target.hp = 80;
  applySkillEffects(battle, actor, health, target.id);
  assert.equal(target.stats.maxHp, 240); assert.equal(target.hp, 80);
  actor.hp = 0; removeDeadEffects(battle);
  assert.equal(target.activeEffects!.length, 1);
  target.hp = 200;
  applySkillEffects(battle, target, { ...skill('purify'), effects: [{ id: 'strip', kind: 'dispel', recipient: 'selected', polarityToRemove: 'buff', maxCount: 1 }] }, target.id);
  assert.equal(target.stats.maxHp, 120); assert.equal(target.hp, 120);
});

test('content rejects unknown references, incompatible units and invalid stacking groups', () => {
  const invalid = structuredClone(content);
  const effect = invalid.skills.find(skill => skill.id === 'battle-cry')!.effects![0] as StatModifierEffect;
  effect.statId = 'unknown'; assert.equal(contentSchema.safeParse(invalid).success, false);
  effect.statId = 'strength'; effect.magnitude.unit = 'hp'; assert.equal(contentSchema.safeParse(invalid).success, false);
  effect.magnitude.unit = 'basis_points'; effect.operation = 'set'; effect.stacking = 'stack';
  assert.equal(contentSchema.safeParse(invalid).success, false);
});

test('NPCs use the same buff and turn lifecycle, without refreshing a healthy effect forever', () => {
  const { first } = fixture();
  const battle = newBattle('npc-effects', 'Бот', 'bot', 'on-match', first, content); startBattle(battle);
  const bot = battle.fighters[1]; battle.activeId = bot.id;
  ready(battle, 'battle-cry'); runNpcTurns(battle);
  assert.equal(battle.activeId, first.id);
  assert.ok(battle.fighters.some(fighter => fighter.activeEffects?.length));
  assert.equal(battle.fighters[1].skillEnergy, 27);
});
