import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activationChance, applyAction, applyCraftRecipe, applyInventoryCommand, contentSchema, createCharacter,
  defaultItemRanks, defaultItemScalingProfiles, defaultModifierDefinitions, defaultProfessions, defaultRankProfiles,
  defaultStatDefinitions, itemModifierRange, joinBattle, modifierDefinitionSchema, newBattle, previewSkillEffects,
  modifierAllowed, modifierPermissionFields,
  canMergeInstances, equipmentAttributeSources,
  qualityForItem, rankedItemDefinition, seedContent, seedEffectSkills, startBattle,
  type Battle, type Content, type InventoryState, type ModifierDefinition, type Skill, type StatModifierEffect,
} from '../src';

function catalog(): Content {
  const content = structuredClone({ ...seedContent, modifierRulesVersion: 1 as const, effectsVersion: 1 as const,
    statDefinitions: defaultStatDefinitions, itemRanks: defaultItemRanks, itemScalingProfiles: defaultItemScalingProfiles,
    modifierDefinitions: defaultModifierDefinitions, professions: defaultProfessions, rankProfiles: defaultRankProfiles,
    skills: [...seedContent.skills, ...seedEffectSkills],
  });
  content.items = content.items.map(item => ({ ...item, itemLevel: 1, version: 1 }));
  content.recipes = content.recipes!.map(recipe => ({ ...recipe, outputs: recipe.outputs.map(output => content.items.find(item => item.id === output.itemId)?.equipSlot
    ? { ...output, rankPolicy: { mode: 'profession' as const, profileId: 'standard' } } : output) }));
  return content;
}
function fixture(skill: Skill, content = catalog()) {
  content.skills.push(skill);
  const hero = createCharacter('hero', 'Герой', content), enemy = createCharacter('enemy', 'Противник', content);
  hero.learnedSkillIds.push(skill.id); hero.skillLevels![skill.id] = 1;
  const battle = newBattle('modifiers-test', 'Бой', 'duel', 'on-match', hero, content);
  joinBattle(battle, enemy, 1); startBattle(battle);
  ready(battle, skill);
  return battle;
}
function buff(): Skill {
  return { ...structuredClone(seedEffectSkills[0]), id: 'probability-test', targeting: { kind: 'self' } };
}
function ready(battle: Battle, skill: Skill) {
  battle.activeId = 'hero'; battle.phase = 'choose'; battle.usedSkill = false; battle.matchedElements = [skill.element];
  const actor = battle.fighters.find(fighter => fighter.id === 'hero')!;
  actor.skillEnergy = 30; actor.cooldowns[skill.id] = 0;
}
function cast(battle: Battle, skill: Skill) {
  applyAction(battle, 'hero', { type: 'skill', skillId: skill.id, targetId: 'hero' });
}

test('rank changes affix count; item level changes ranges; legacy quality retains its exact base', () => {
  const content = catalog(), item = content.items.find(item => item.id === 'iron-sword')!;
  for (const rank of defaultItemRanks) {
    const low = qualityForItem(item, { mode: 'fixed', rankId: rank.id }, 1, content, () => 0);
    const high = qualityForItem({ ...item, itemLevel: 11 }, { mode: 'fixed', rankId: rank.id }, 1, content, () => 0);
    assert.equal(low.affixes.length, rank.affixCount); assert.equal(high.affixes.length, rank.affixCount);
    assert.equal(rankedItemDefinition(item, { quality: low }).bonuses!.attack, item.bonuses!.attack);
    for (let index = 0; index < low.affixes.length; index++) assert.equal(high.affixes[index].value, low.affixes[index].value * 2);
  }
  const quality = qualityForItem(item, { mode: 'fixed', rankId: 'rare' }, 1, content, () => 0);
  const saved = JSON.parse(JSON.stringify(quality));
  assert.deepEqual(rankedItemDefinition({ ...item, bonuses: { attack: 999 } }, { quality: saved }).bonuses, item.bonuses);
  const legacy = { rank: defaultItemRanks[3], affixes: [] };
  assert.equal(rankedItemDefinition(item, { quality: legacy }).bonuses!.attack, Math.floor(item.bonuses!.attack! * 1.6));
  assert.ok(quality.affixes.every(affix => affix.profileVersion === 1 && affix.activationChanceBps === 10000));
});

test('weighted choice has exact slot boundaries, excludes zero weights and allows repeated affixes', () => {
  const content = catalog(), item = content.items.find(item => item.id === 'iron-sword')!;
  const definition = defaultModifierDefinitions[0];
  content.modifierDefinitions = [
    { ...definition, id: 'a', craftWeight: 1 }, { ...definition, id: 'b', craftWeight: 3 }, { ...definition, id: 'c', craftWeight: 0 },
  ];
  const pick = (draw: number) => { let calls = 0; return qualityForItem(item, { mode: 'fixed', rankId: 'fine' }, 1, content, () => calls++ === 0 ? draw : 0); };
  assert.equal(pick(0).affixes[0].effectId, 'a'); assert.equal(pick(1).affixes[0].effectId, 'b'); assert.equal(pick(3).affixes[0].effectId, 'b');
  assert.deepEqual(qualityForItem(item, { mode: 'fixed', rankId: 'superior' }, 1, content, () => 0).affixes.map(affix => affix.effectId), ['a', 'a']);
  assert.deepEqual(qualityForItem(item, { mode: 'fixed', rankId: 'rare' }, 1, content, () => 0).affixes.map(affix => affix.effectId), ['a', 'a', 'a']);
  content.modifierDefinitions = [{ ...definition, id: 'only', craftWeight: 1 }];
  assert.ok(contentSchema.safeParse(content).success);
  const rolls = [0, 0, 0, 1, 0, 2];
  const repeated = qualityForItem(item, { mode: 'fixed', rankId: 'rare' }, 1, content, () => rolls.shift()!);
  assert.deepEqual(repeated.affixes.map(affix => affix.value), [1, 2, 3]);
  const sources = equipmentAttributeSources({ ownerId: 'hero', inventories: [], items: [{ id: 'repeat', itemId: item.id, ownerId: 'hero', inventoryId: null, quantity: 1, equippedSlot: item.equipSlot!, quality: repeated }] }, content.items);
  const modifiers = sources.modifiers.filter(modifier => modifier.id.includes(':affix:'));
  assert.equal(new Set(modifiers.map(modifier => modifier.id)).size, 3);
  assert.equal(modifiers.reduce((sum, modifier) => sum + modifier.value, 0), 6);
  content.modifierDefinitions = [];
  assert.equal(contentSchema.safeParse(content).success, false);
  assert.throws(() => qualityForItem(item, { mode: 'fixed', rankId: 'fine' }, 1, content, () => 0), /Недостаточно/);
});

test('scaling handles signed ranges, neutral multipliers and configured caps', () => {
  const definition = { ...defaultModifierDefinitions[0], baseValue: -10, itemRoll: { minFactorBps: 8000, maxFactorBps: 12000, scalingProfileId: 'flat-stat' } };
  assert.deepEqual(itemModifierRange(definition, 11, defaultItemScalingProfiles), { minValue: -24, maxValue: -16, profileId: 'flat-stat', profileVersion: 1 });
  const multiplier: ModifierDefinition = { ...definition, operation: 'multiply', baseValue: 12000, itemRoll: { minFactorBps: 10000, maxFactorBps: 10000, scalingProfileId: 'flat-stat' } };
  assert.equal(itemModifierRange(multiplier, 11, defaultItemScalingProfiles).minValue, 14000);
  assert.equal(itemModifierRange(multiplier, 1000, defaultItemScalingProfiles).minValue, 30000);
  assert.throws(() => itemModifierRange(definition, 0, defaultItemScalingProfiles), /уровень/);
});

test('new content requires all boolean permissions, compatible profiles and both source and buff permissions', () => {
  const content = catalog(); assert.ok(contentSchema.safeParse(content).success);
  assert.equal(modifierDefinitionSchema.safeParse({ ...defaultModifierDefinitions[0], allowPotion: 1 }).success, false);
  const missing = { ...defaultModifierDefinitions[0] }; delete missing.allowBuff;
  assert.equal(modifierDefinitionSchema.safeParse(missing).success, false);
  const skill = buff(), effect = skill.effects![0] as StatModifierEffect, definition = content.modifierDefinitions![0];
  Object.assign(effect, { stackKey: 'reference-test', modifierDefinitionId: definition.id, statId: definition.statId, operation: definition.operation, magnitude: { unit: 'points', constant: 0 }, coefficientBps: 10000 });
  content.skills.push(skill); assert.ok(contentSchema.safeParse(content).success);
  definition.allowBuff = false; assert.equal(contentSchema.safeParse(content).success, false);
  definition.allowBuff = true; definition.itemRoll!.scalingProfileId = 'missing'; assert.equal(contentSchema.safeParse(content).success, false);
});

test('all seven permission fields are independent booleans across 128 combinations', () => {
  for (let mask = 0; mask < 128; mask++) {
    const definition = { ...defaultModifierDefinitions[0], ...Object.fromEntries(modifierPermissionFields.map((field, index) => [field, !!(mask & (1 << index))])) };
    assert.equal(modifierDefinitionSchema.safeParse(definition).success, true);
    for (let index = 0; index < modifierPermissionFields.length; index++) assert.equal(modifierAllowed(definition, modifierPermissionFields[index]), !!(mask & (1 << index)));
  }
});

test('skill combines reference base, rank coefficient and attribute terms before rounding', () => {
  const content = catalog(), definition = content.modifierDefinitions![0], skill = buff();
  Object.assign(skill.effects![0], { modifierDefinitionId: definition.id, modifierDefinitionVersion: definition.version,
    statId: definition.statId, operation: definition.operation, coefficientBps: 1250, coefficientPerSkillRankBps: 1250,
    magnitude: { unit: 'points', terms: [{ scope: 'caster', statId: 'strength', weightBps: 750 }] } });
  const battle = fixture(skill, content), actor = battle.fighters[0];
  assert.equal(previewSkillEffects(battle, actor, skill)[0].magnitude, 2); // 10×.125 + 10×.075 = 2
  actor.skillLevels![skill.id] = 2;
  assert.equal(previewSkillEffects(battle, actor, skill)[0].magnitude, 3);
  cast(battle, skill); assert.equal(battle.fighters[0].activeEffects![0].magnitude, 3);
});

test('activation chance can grow and cap per effect; previews never consume the stream', () => {
  const skill = buff(); Object.assign(skill.effects![0], { activationChanceBps: 3000, chancePerSkillRankBps: 200, maxChanceBps: 4000 });
  const battle = fixture(skill), actor = battle.fighters[0];
  assert.equal(previewSkillEffects(battle, actor, skill)[0].activationChanceBps, 3000);
  actor.skillLevels![skill.id] = 10;
  assert.equal(previewSkillEffects(battle, actor, skill)[0].activationChanceBps, 4000);
  assert.equal(battle.attributeRngState, undefined);
  assert.equal(activationChance({ activationChanceBps: 3000 }, 10), 3000);
});

test('failed effects spend the cast but not other effects; 0 and 100 percent do not consume RNG', () => {
  const skill = buff(); skill.effects![0].activationChanceBps = 0;
  skill.effects!.push({ ...structuredClone(skill.effects![0]), id: 'guaranteed', activationChanceBps: 10000 });
  const battle = fixture(skill); cast(battle, skill);
  assert.equal(battle.fighters[0].skillEnergy, 30 - skill.cost);
  assert.equal(battle.fighters[0].activeEffects!.length, 1);
  assert.ok(battle.fighters[0].cooldowns[skill.id] > 0);
  assert.deepEqual(battle.effectResults!.map(result => result.outcome), ['chance_failed', 'applied']);
  assert.equal(battle.attributeRngState, undefined);
});

test('chance failures preserve existing buff stacks and deadlines; RNG resumes after JSON restore', () => {
  const skill = buff(); skill.effects![0].activationChanceBps = 10000;
  const battle = fixture(skill); cast(battle, skill);
  const snapshot = structuredClone(battle.fighters[0].activeEffects);
  skill.effects![0].activationChanceBps = 1; // seed zero produces > 1 bps
  battle.content.skills.find(value => value.id === skill.id)!.effects![0].activationChanceBps = 1;
  ready(battle, skill); battle.attributeRngState = 0;
  const restored = JSON.parse(JSON.stringify(battle));
  cast(battle, skill); cast(restored, skill);
  assert.deepEqual(restored, battle);
  assert.deepEqual(battle.fighters[0].activeEffects, snapshot);
});

test('invalid final effect rolls back consumed RNG, first effect, energy and cooldown', () => {
  const skill = buff(); skill.effects![0].activationChanceBps = 9999;
  skill.effects!.push({ ...structuredClone(skill.effects![0] as StatModifierEffect), id: 'overflow', stackKey: 'overflow', activationChanceBps: 10000 });
  const battle = fixture(skill); battle.attributeRngState = 0;
  // First refresh replaces the existing group; second new group overflows the cap.
  const target = battle.fighters[0];
  target.activeEffects = Array.from({ length: 64 }, (_, index) => ({ kind: 'stat_modifier' as const, instanceId: `effect-${index}`, definitionId: 'old', name: 'old', sourceFighterId: 'hero', sourceSkillId: 'old', sourceRank: 1,
    targetFighterId: 'hero', polarity: 'buff', tags: [], dispellable: true, statId: 'strength', operation: 'add_percent', magnitude: 0, unit: 'basis_points', priority: 0,
    remainingTurns: 2, eligibleFromTurn: 2, appliedSequence: index, stackKey: index === 0 ? (skill.effects![0] as StatModifierEffect).stackKey! : `group-${index}`, stacking: 'refresh', stacks: 1, maxStacks: 1 }));
  const before = structuredClone(battle);
  assert.throws(() => cast(battle, skill), /лимит/); assert.deepEqual(battle, before);
});

test('group effects roll independently per stable target; missed damage never rolls critical', () => {
  const skill = buff(); skill.targeting = { kind: 'allies_all' }; skill.effects![0].activationChanceBps = 2500;
  const battle = fixture(skill);
  battle.fighters.push({ ...structuredClone(battle.fighters[0]), id: 'friend', characterId: undefined, name: 'Союзник' });
  battle.attributeRngState = 0; cast(battle, skill);
  assert.deepEqual(battle.effectResults!.map(value => [value.targetId, value.outcome]), [['friend', 'applied'], ['hero', 'chance_failed']]);
  assert.equal(battle.attributeRngState, 1196435762);
  const attack = buff(); attack.effects = [{ id: 'missed-damage', recipient: 'caster', kind: 'damage', damageType: 'physical', canCrit: true, activationChanceBps: 0,
    magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: 'physicalPower', weightBps: 10000 }], min: 0 } }];
  const miss = fixture(attack); cast(miss, attack); assert.equal(miss.attributeRngState, undefined);
});

test('old battle content keeps its original guaranteed application and formula', () => {
  const skill = buff(); skill.effects![0].activationChanceBps = 0;
  const old = catalog(); delete old.modifierRulesVersion;
  const battle = fixture(skill, old); cast(battle, skill);
  assert.equal(battle.fighters[0].activeEffects!.length, 1); assert.equal(battle.attributeRngState, undefined);
});

test('crafted level, quality and saved ranges survive transfer/equip; old instances are never rerolled', () => {
  const content = catalog(), item = content.items.find(item => item.id === 'iron-sword')!; item.itemLevel = 11;
  const state: InventoryState = { ownerId: 'hero', inventories: [{ id: 'bag', ownerId: 'hero', name: 'bag', primary: true, capacity: 50 }], items: [{ id: 'ore', ownerId: 'hero', inventoryId: 'bag', itemId: 'iron-ore', quantity: 20, equippedSlot: null }] };
  const recipe = { id: 'test', name: 'test', description: '', kind: 'craft' as const, knownByDefault: true, professionId: 'blacksmith', inputs: [{ itemId: 'iron-ore', quantity: 3 }], outputs: [{ itemId: item.id, quantity: 1, rankPolicy: { mode: 'fixed' as const, rankId: 'rare' } }] };
  const crafted = applyCraftRecipe(state, recipe, content.items, () => 'sword', { content, xp: {}, roll: () => 0 });
  const instance = crafted.result.createdItems![0]; assert.equal(instance.itemLevel, 11);
  const saved = JSON.stringify(instance.quality);
  const equipped = applyInventoryCommand([crafted.state], { type: 'equip', instanceId: instance.id }, content.items, content.itemGroups, () => 'unused');
  assert.equal(JSON.stringify(equipped.states[0].items.find(value => value.id === instance.id)!.quality), saved);
  assert.deepEqual(state.items[0].quantity, 20);
});

test('stacks of different levels or definition versions cannot merge or lose their metadata', () => {
  const source = { id: 'first', ownerId: 'hero', inventoryId: 'bag', itemId: 'potion', quantity: 2, equippedSlot: null, itemLevel: 1, definitionVersion: 1 };
  const target = { ...source, id: 'second', itemLevel: 11 };
  assert.equal(canMergeInstances(source, target, 99), false);
  assert.equal(canMergeInstances(source, { ...target, itemLevel: 1, definitionVersion: 2 }, 99), false);
  const { itemLevel: _level, definitionVersion: _version, ...legacy } = target;
  assert.equal(canMergeInstances(source, legacy, 99), true);
});
