import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCraftRecipe, applyInventoryCommand, calculateAttributes, contentSchema, defaultItemRanks,
  defaultModifierDefinitions, defaultProfessions, defaultRankProfiles, defaultStatDefinitions,
  equipmentAttributeSources, fillBaseAttributes, professionProgress, qualityForItem, rankedItemDefinition,
  seedContent, type Content, type CraftingRecipe, type InventoryState,
} from '../src';
import { applyResolvedDamage } from '../src/combat/damage';
import { characterFighter, createCharacter, newBattle } from '../src';

const content: Content = { ...seedContent, statDefinitions: defaultStatDefinitions, itemRanks: defaultItemRanks,
  professions: defaultProfessions, rankProfiles: defaultRankProfiles, modifierDefinitions: defaultModifierDefinitions,
  recipes: seedContent.recipes!.map(recipe => ({ ...recipe, outputs: recipe.outputs.map(output => seedContent.items.find(item => item.id === output.itemId)?.equipSlot ? { ...output, rankPolicy: { mode: 'profession', profileId: 'standard' } } : output) })),
};
const sword = content.items.find(item => item.id === 'iron-sword')!;
const recipe: CraftingRecipe = { ...content.recipes!.find(recipe => recipe.id === 'craft-iron-sword')!, professionId: 'blacksmith' };
const state: InventoryState = { ownerId: 'owner', inventories: [{ id: 'bag', ownerId: 'owner', name: 'Рюкзак', primary: true, capacity: 50 }], items: [{ id: 'ore', ownerId: 'owner', inventoryId: 'bag', itemId: 'iron-ore', quantity: 100, equippedSlot: null }] };

test('rank distributions normalize and every upper-tail probability grows monotonically with profession', () => {
  assert.ok(contentSchema.safeParse(content).success);
  for (let level = 1; level <= 100; level++) {
    const chances = defaultRankProfiles[0].levels[level - 1].chances;
    assert.equal(chances.reduce((sum, value) => sum + value.chanceBps, 0), 10000);
    if (level === 1) continue;
    for (const rank of defaultItemRanks) {
      const tail = (i: number) => defaultRankProfiles[0].levels[i].chances.filter(chance => defaultItemRanks.find(entry => entry.id === chance.rankId)!.order >= rank.order).reduce((sum, chance) => sum + chance.chanceBps, 0);
      assert.ok(tail(level - 1) >= tail(level - 2));
    }
  }
  assert.equal(professionProgress(99).level, 1);
  assert.deepEqual(professionProgress(100), { level: 2, xp: 0, xpToNext: 120, totalXp: 100 });
  assert.equal(professionProgress(1_000_000).level, 100);
});

test('the same rank roll produces a higher rank at a higher profession level', () => {
  const policy = { mode: 'profession' as const, profileId: 'standard' };
  assert.equal(qualityForItem(sword, policy, 1, content, () => 5000).rank.id, 'common');
  // Affix rolls use 0; only the first call selects rank.
  let first = true;
  const high = qualityForItem(sword, policy, 100, content, () => { if (first) { first = false; return 5000; } return 0; });
  assert.ok(high.rank.order > 1);
});

test('each rank adds one distinct compatible affix, inclusive rolled values and fixed ranks do not roll rank', () => {
  for (const rank of defaultItemRanks) {
    const maxima: number[] = [];
    const quality = qualityForItem(sword, { mode: 'fixed', rankId: rank.id }, 1, content, max => { maxima.push(max); return max - 1; });
    assert.equal(quality.affixes.length, rank.order - 1);
    assert.equal(maxima.length, rank.affixCount * 2);
    assert.equal(new Set(quality.affixes.map(affix => affix.effectId)).size, rank.affixCount);
    for (const affix of quality.affixes) assert.equal(affix.value, content.modifierDefinitions!.find(effect => effect.id === affix.effectId)!.maxValue);
  }
  const disallowed = { ...content, modifierDefinitions: content.modifierDefinitions!.map(effect => ({ ...effect, allowWeapon: false })) };
  assert.throws(() => qualityForItem(sword, { mode: 'fixed', rankId: 'rare' }, 100, disallowed, () => 0), /Недостаточно/);
});

test('craft quality snapshots and profession XP survive transfer/equip, rollback leaves inputs and XP untouched', () => {
  const xp = { blacksmith: 90 };
  const fixed = { ...recipe, outputs: [{ itemId: sword.id, quantity: 1, rankPolicy: { mode: 'fixed' as const, rankId: 'rare' } }] };
  const crafted = applyCraftRecipe(state, fixed, content.items, () => 'sword', { content, xp, roll: () => 0 });
  assert.equal(xp.blacksmith, 100);
  const instance = crafted.state.items.find(item => item.id === 'sword')!;
  assert.equal(instance.quality!.rank.id, 'rare'); assert.equal(instance.quality!.affixes.length, 3);
  assert.deepEqual(crafted.result.createdItems, [instance]);
  const moved = applyInventoryCommand([crafted.state, { ownerId: 'other', inventories: [{ id: 'other-bag', ownerId: 'other', name: 'Рюкзак', primary: true, capacity: 50 }], items: [] }], { type: 'transfer', instanceId: 'sword', targetInventoryId: 'other-bag', quantity: 1 }, content.items, content.itemGroups, () => 'new');
  assert.deepEqual(moved.states[1].items[0].quality, instance.quality);
  const equipped = applyInventoryCommand(moved.states, { type: 'equip', instanceId: 'sword' }, content.items, content.itemGroups, () => 'new');
  const sources = equipmentAttributeSources(equipped.states[1], content.items);
  assert.equal(sources.modifiers.filter(modifier => modifier.id.includes(':affix:')).length, 3);
  const attributes = calculateAttributes({ definitions: defaultStatDefinitions, baseAttributes: fillBaseAttributes({}, 1, defaultStatDefinitions), equipmentModifiers: sources.modifiers, equipmentScaling: sources.scaling });
  assert.ok(attributes.effective.physicalPower > attributes.base.physicalPower);
  assert.equal(rankedItemDefinition(sword, instance).bonuses!.attack, Math.floor(sword.bonuses!.attack! * 1.6));
  const full = { ...state, inventories: [{ ...state.inventories[0], capacity: 1 }] };
  const beforeXp = { ...xp };
  assert.throws(() => applyCraftRecipe(full, fixed, content.items, () => 'sword', { content, xp, roll: () => 0 }), /заполнен/);
  assert.deepEqual(xp, beforeXp); assert.equal(state.items[0].quantity, 100);
});

test('invalid flags, distributions, references and unsupported output policies are rejected', () => {
  const bad = (edit: (value: Content) => void) => { const value = structuredClone(content); edit(value); assert.equal(contentSchema.safeParse(value).success, false); };
  bad(value => { (value.modifierDefinitions![0] as any).allowWeapon = 1; });
  bad(value => { delete (value.modifierDefinitions![0] as any).allowSkill; });
  bad(value => { value.rankProfiles![0].levels[0].chances[0].chanceBps++; });
  bad(value => { value.recipes![0].outputs[0].rankPolicy = { mode: 'fixed', rankId: 'missing' }; });
  bad(value => { value.recipes!.find(entry => entry.id === 'brew-potion')!.outputs[0].rankPolicy = { mode: 'fixed', rankId: 'rare' }; });
});

test('physical damage flat is added after defense, is not critical-scaled and never affects magic', () => {
  const actor = characterFighter(createCharacter('actor', 'Атакующий', content), 0, content);
  const target = characterFighter(createCharacter('target', 'Защитник', content), 1, content);
  const battle = newBattle('flat-test', 'Проверка', 'duel', 'on-match', createCharacter('hero', 'Герой', content), content);
  battle.fighters = [actor, target]; target.hp = 1000;
  actor.attributes!.effective.physicalDamageFlat = 5;
  actor.attributes!.effective.criticalChanceBps = 10000; actor.attributes!.effective.criticalBonusBps = 5000;
  target.attributes!.effective.physicalResistance = 6; target.attributes!.effective.fireResistance = 6; target.guardDefense = 2;
  assert.equal(applyResolvedDamage(battle, actor, target, 20, 'physical'), 27); // 30 − 6 − 2 + 5
  assert.equal(applyResolvedDamage(battle, actor, target, 20, 'fire'), 22);
});

test('all eight applicability-flag combinations independently control weapon, armor and skill references', () => {
  const armor = content.items.find(item => item.id === 'leather-armor')!;
  for (let flags = 0; flags < 8; flags++) {
    const definition = { ...defaultModifierDefinitions[0], allowSkill: !!(flags & 1), allowWeapon: !!(flags & 2), allowArmor: !!(flags & 4) };
    const single = { ...content, modifierDefinitions: [definition] };
    for (const [item, allowed] of [[sword, definition.allowWeapon], [armor, definition.allowArmor]] as const) {
      const create = () => qualityForItem(item, { mode: 'fixed', rankId: 'fine' }, 1, single, () => 0);
      if (allowed) assert.equal(create().affixes[0].effectId, definition.id);
      else assert.throws(create, /Недостаточно/);
    }
    const skillContent = structuredClone(content);
    skillContent.modifierDefinitions![0] = definition;
    const skill = structuredClone(skillContent.skills[0]);
    skill.id = 'flag-test-skill';
    skill.learning.starter = false;
    skillContent.skills.push(skill);
    skill.targeting = { kind: 'self' }; skill.effect = 'modifier';
    skill.effects = [{ id: 'shared-bonus', modifierDefinitionId: definition.id, recipient: 'caster', kind: 'stat_modifier',
      polarity: 'buff', statId: definition.statId, operation: definition.operation, magnitude: { unit: 'points', constant: 3 }, durationTurns: 2 }];
    assert.equal(contentSchema.safeParse(skillContent).success, definition.allowSkill);
  }
});
