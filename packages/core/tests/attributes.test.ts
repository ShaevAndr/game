import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateAttributes, calculateAttributes, characterFighter, contentSchema, createCharacter, defaultStatDefinitions, fillBaseAttributes, gainExperience, newBattle, normalizeCharacter, replaceFighterModifiers, seedContent, startBattle, type StatModifier } from '../src';
import { damage } from '../src/combat/common';

const definitions = defaultStatDefinitions;
const content = { ...seedContent, statDefinitions: definitions };
const baseAttributes = fillBaseAttributes({}, 1, definitions);
const modifier = (id: string, statId: string, operation: StatModifier['operation'], value: number): StatModifier => ({ id, statId, operation, value, sourceId: id });

test('five primaries produce HP, separate powers, five resistances, luck and guard', () => {
  assert.equal(definitions.filter(definition => definition.kind === 'primary').length, 5);
  const result = calculateAttributes({ definitions, baseAttributes });
  assert.deepEqual(Object.fromEntries(Object.entries(result.effective).filter(([id]) => !Object.keys(baseAttributes).includes(id))), {
    maxHp: 120, physicalPower: 8, physicalDamageFlat: 0, magicPower: 8, healingPower: 8, physicalResistance: 3,
    fireResistance: 3, waterResistance: 3, earthResistance: 3, airResistance: 3,
    criticalChanceBps: 500, criticalBonusBps: 5000, guardPerCell: 10,
  });
});

test('weapon synergy preserves the benefit of both attributes and upgrading the weapon', () => {
  const power = (strength: number, weapon: number) => calculateAttributes({ definitions, baseAttributes: { ...baseAttributes, strength }, equipmentScaling: [{ id: 'weapon', sourceId: 'sword', statId: 'physicalPower', baseValue: weapon, scalingStatId: 'physicalPower', coefficientBps: 500 }] }).effective.physicalPower;
  assert.equal(power(10, 0), 8); assert.equal(power(10, 3), 12);
  assert.equal(power(20, 3), 19); assert.equal(power(10, 6), 16);
  assert.ok(power(20, 1000) > power(10, 1000));
  assert.ok(power(1000, 6) > power(1000, 3));
});

test('primary equipment applies before buffs; every dependent value is recalculated', () => {
  const result = calculateAttributes({ definitions, baseAttributes,
    equipmentModifiers: [modifier('gloves', 'strength', 'add_flat', 5)],
    temporaryModifiers: [modifier('potion', 'strength', 'add_percent', 2000)],
  });
  assert.deepEqual(result.breakdown.strength, { base: 10, equipped: 15, effective: 18 });
  assert.equal(result.effective.physicalPower, 12);
  assert.equal(result.effective.magicPower, 8);
});

test('overlapping percentages combine before multipliers and round only once', () => {
  const custom = structuredClone(definitions);
  const physical = custom.find(definition => definition.id === 'physicalPower')!;
  assert.equal(physical.kind, 'derived');
  if (physical.kind === 'derived') physical.formula = { constant: 20, terms: [] };
  const effects = [modifier('buff-a', 'physicalPower', 'add_percent', 2000), modifier('buff-b', 'physicalPower', 'add_percent', 3000), modifier('multiplier', 'physicalPower', 'multiply', 11000)];
  const run = (temporaryModifiers: StatModifier[]) => calculateAttributes({ definitions: custom, baseAttributes, equipmentModifiers: [modifier('weapon', 'physicalPower', 'add_flat', 5)], temporaryModifiers }).effective.physicalPower;
  assert.equal(run(effects), 41);
  assert.equal(run([...effects].reverse()), 41);
  assert.equal(run(effects.filter(effect => effect.id !== 'buff-a')), 35);
  assert.equal(run([]), 25);
});

test('set respects priority and application order; removing it restores other modifiers', () => {
  const effects = [{ ...modifier('earlier', 'physicalPower', 'set', 40), priority: 2, appliedSequence: 1 }, { ...modifier('later', 'physicalPower', 'set', 50), priority: 2, appliedSequence: 2 }, modifier('flat', 'physicalPower', 'add_flat', 4)];
  assert.equal(calculateAttributes({ definitions, baseAttributes, temporaryModifiers: effects }).effective.physicalPower, 50);
  assert.equal(calculateAttributes({ definitions, baseAttributes, temporaryModifiers: effects.filter(effect => effect.id === 'flat') }).effective.physicalPower, 12);
});

test('HP changes clamp current health without free healing or resurrection', () => {
  const hero = createCharacter('hero', 'Герой', content), fighter = characterFighter(hero, 0, content);
  fighter.hp = 90;
  replaceFighterModifiers(fighter, [modifier('vitality', 'vitality', 'add_flat', 10)], definitions);
  assert.equal(fighter.stats.maxHp, 240); assert.equal(fighter.hp, 90);
  fighter.hp = 200;
  replaceFighterModifiers(fighter, [], definitions);
  assert.equal(fighter.hp, 120);
  fighter.hp = 0;
  replaceFighterModifiers(fighter, [modifier('revive-not-allowed', 'maxHp', 'add_flat', 500)], definitions);
  assert.equal(fighter.hp, 0);
});

test('new leveling gives five unspent points and allocation is atomic', () => {
  let hero = createCharacter('hero', 'Герой', content);
  assert.equal(hero.attributePoints, 0);
  gainExperience(hero, 100, content.balance.progression);
  assert.equal(hero.attributePoints, 5);
  assert.deepEqual(hero.baseAttributes, baseAttributes);
  const before = structuredClone(hero);
  assert.throws(() => allocateAttributes(hero, { strength: 6 }, content), /Недостаточно/);
  assert.deepEqual(hero, before);
  hero = allocateAttributes(hero, { strength: 3, vitality: 2 }, content);
  assert.equal(hero.attributePoints, 0); assert.equal(hero.baseAttributes?.strength, 13);
  assert.equal(hero.attributes?.base.maxHp, 144);
  assert.equal(hero.attributeRevision, 2);
  assert.throws(() => allocateAttributes(hero, { physicalPower: 1 }, content), /первичная/);
});

test('old heroes are recalculated with level points and retain their progress; repeated normalization is stable', () => {
  const legacy = createCharacter('legacy', 'Старый герой', seedContent);
  legacy.level = 10; legacy.experience = 34; legacy.stats.maxHp = 999;
  const hero = normalizeCharacter(legacy, content);
  assert.equal(hero.attributePoints, 45); assert.equal(hero.stats.maxHp, 120);
  assert.equal(hero.experience, 34); assert.equal(hero.level, 10);
  assert.deepEqual(hero.inventory, legacy.inventory);
  assert.deepEqual(hero.skillLevels, legacy.skillLevels);
  assert.deepEqual(normalizeCharacter(hero, content), hero);
  assert.deepEqual(fillBaseAttributes(hero.baseAttributes!, 10, definitions), hero.baseAttributes);
});

test('registry rejects cycles, unknown references, duplicate IDs, bad units and negative multipliers', () => {
  const cycle = structuredClone(definitions);
  const physical = cycle.find(definition => definition.id === 'physicalPower')!;
  if (physical.kind === 'derived') physical.formula.terms = [{ statId: 'physicalPower', coefficientBps: 10000 }];
  assert.throws(() => calculateAttributes({ definitions: cycle, baseAttributes }), /цикл/);
  assert.throws(() => calculateAttributes({ definitions: [...definitions, definitions[0]], baseAttributes }), /уникальными/);
  const unknown = structuredClone(cycle);
  const missing = unknown.find(definition => definition.id === 'physicalPower')!;
  if (missing.kind === 'derived') missing.formula.terms = [{ statId: 'unknown', coefficientBps: 10000 }];
  assert.throws(() => calculateAttributes({ definitions: unknown, baseAttributes }), /Неизвестная/);
  const badUnits = structuredClone(content); badUnits.statDefinitions.find(definition => definition.id === 'maxHp')!.unit = 'points';
  assert.equal(contentSchema.safeParse(badUnits).success, false);
  assert.throws(() => calculateAttributes({ definitions, baseAttributes, temporaryModifiers: [modifier('negative', 'physicalPower', 'multiply', -1)] }), /отрицательным/);
});

test('magic uses magic power and its own resistance; battle RNG survives a snapshot round trip', () => {
  const hero = createCharacter('hero', 'Герой', content), battle = newBattle('battle', 'Проверка', 'bot', 'on-match', hero, content);
  startBattle(battle);
  const [actor, victim] = battle.fighters;
  replaceFighterModifiers(actor, [modifier('no-crit', 'criticalChanceBps', 'set', 0), modifier('magic', 'magicPower', 'set', 20)], definitions);
  replaceFighterModifiers(victim, [modifier('fire-protection', 'fireResistance', 'add_flat', 10)], definitions);
  damage(battle, actor, victim, 8, 'fire');
  assert.equal(victim.hp, 120 - (40 - 13));
  const restored = JSON.parse(JSON.stringify(battle));
  damage(battle, actor, victim, 8, 'water');
  damage(restored, restored.fighters[0], restored.fighters[1], 8, 'water');
  assert.equal(victim.hp, 120 - 27 - 37);
  assert.deepEqual(restored, battle);
});

test('registry extension fills only missing primary values and formulas can use the new ID', () => {
  const custom = structuredClone(definitions);
  custom.push({ ...custom[0], id: 'wisdom', name: 'Мудрость', kind: 'primary', defaultValue: 10, growthPerLevel: 0 });
  const magic = custom.find(definition => definition.id === 'magicPower')!;
  if (magic.kind === 'derived') magic.formula.terms.push({ statId: 'wisdom', coefficientBps: 10000 });
  const filled = fillBaseAttributes({ ...baseAttributes, strength: 17 }, 10, custom);
  assert.equal(filled.wisdom, 10); assert.equal(filled.strength, 17);
  assert.deepEqual(fillBaseAttributes(filled, 10, custom), filled);
  assert.equal(calculateAttributes({ definitions: custom, baseAttributes: filled }).effective.magicPower, 18);
});
