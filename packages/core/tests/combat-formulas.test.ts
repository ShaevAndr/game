import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, applySkillEffects, calculateAttributes, characterFighter, combatStatDefinitions, contentSchema, createCharacter,
  damageChances, defaultCombatFormulaRules, defaultStatDefinitions, fillBaseAttributes, joinBattle, newBattle,
  previewSkillEffects, replaceFighterModifiers, seedContent, skillChoices, startBattle,
  type Battle, type Content, type Skill, type StatModifier,
} from '../src';
import { damage, applyResolvedDamage } from '../src/combat/damage';
import { battleRandomBps } from '../src/combat/random';

function catalog(): Content {
  return structuredClone({ ...seedContent, effectsVersion: 1, statDefinitions: combatStatDefinitions,
    balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules } });
}
function fixture() {
  const content = catalog(), hero = createCharacter('hero', 'Герой', content), enemy = createCharacter('enemy', 'Цель', content);
  const battle = newBattle('formulas', 'Бой', 'duel', 'on-match', hero, content);
  joinBattle(battle, enemy, 1); startBattle(battle, () => 0); battle.attributeRngState = 0;
  return { battle, actor: battle.fighters[0], target: battle.fighters[1] };
}
function seedFor(min: number, max: number) {
  for (let seed = 0; seed < 100000; seed++) {
    const probe = { attributeRngState: seed } as Battle, roll = battleRandomBps(probe);
    if (roll >= min && roll < max) return seed;
  }
  throw new Error('Нет контрольного seed');
}
const modifier = (statId: string, value: number): StatModifier => ({ id: statId, sourceId: 'test', statId, operation: 'add_flat', value });

test('new profile preserves starting HP/power, grows with level and separates critical severity from luck', () => {
  const content = catalog(); assert.ok(contentSchema.safeParse(content).success);
  const hero = createCharacter('hero', 'Герой', content), first = characterFighter(hero, 0, content);
  assert.equal(first.stats.maxHp, 120); assert.equal(first.stats.attack, 8);
  assert.equal(first.attributes!.effective.accuracy, 120); assert.equal(first.attributes!.effective.evasion, 20);
  hero.level = 10;
  const grown = characterFighter(hero, 0, content);
  assert.equal(grown.combatLevel, 10); assert.equal(grown.stats.maxHp, 174); assert.equal(grown.stats.attack, 22);
  replaceFighterModifiers(grown, [modifier('luck', 90)], content.statDefinitions!);
  assert.equal(grown.attributes!.effective.criticalChanceBps, 5000);
  assert.equal(grown.attributes!.effective.criticalBonusBps, 5000);
  replaceFighterModifiers(grown, [], content.statDefinitions!);
  assert.equal(grown.stats.maxHp, 174); assert.equal(grown.stats.attack, 22);
});

test('primary defense amplification includes equipment and recalculates without accumulation', () => {
  const input = { definitions: combatStatDefinitions, baseAttributes: fillBaseAttributes({}, 1, combatStatDefinitions),
    equipmentModifiers: [modifier('physicalResistance', 100)] };
  assert.equal(calculateAttributes(input).effective.physicalResistance, 105);
  const stronger = { ...input, temporaryModifiers: [modifier('strength', 100)] };
  assert.equal(calculateAttributes(stronger).effective.physicalResistance, 128);
  assert.deepEqual(calculateAttributes(input), calculateAttributes(input));
  const cyclic = structuredClone(combatStatDefinitions), power = cyclic.find(stat => stat.id === 'physicalPower')!;
  if (power.kind === 'derived') power.formula.factor!.terms = [{ statId: 'physicalPower', coefficientBps: 1 }];
  assert.throws(() => calculateAttributes({ ...input, definitions: cyclic }), /цикл/);
});

test('physical misses are small, accuracy helps, magic does not roll a physical miss', () => {
  const { battle, actor, target } = fixture();
  assert.equal(damageChances(battle, actor, target, 'physical').hitChanceBps, 9885);
  target.attributes!.effective.evasion = 1000000;
  assert.equal(damageChances(battle, actor, target, 'physical').hitChanceBps, 9500);
  actor.attributes!.effective.accuracy = 1000000; target.attributes!.effective.evasion = 100000;
  assert.ok(damageChances(battle, actor, target, 'physical').hitChanceBps > 9500);
  assert.equal(damageChances(battle, actor, target, 'fire').hitChanceBps, 10000);
  actor.attributes!.effective.accuracy = 0; target.attributes!.effective.evasion = 0;
  assert.equal(damageChances(battle, actor, target, 'physical').hitChanceBps, 9900);
});

test('a magical skill never misses even when one damage component is physical', () => {
  const { battle, actor, target } = fixture();
  const skill: Skill = { ...battle.content.skills.find(skill => skill.id === 'ember')!, effects: [{
    id: 'impact', recipient: 'selected', kind: 'damage', damageType: 'physical', canCrit: false,
    magnitude: { unit: 'hp', constant: 20 },
  }] };
  battle.attributeRngState = seedFor(9900, 10000);
  assert.equal(previewSkillEffects(battle, actor, skill)[0].hitChanceBps, 10000);
  applySkillEffects(battle, actor, skill, target.id);
  assert.equal(target.hp, 102); assert.equal(battle.damageResults![0].outcome, 'hit');
});

test('luck avoidance depends on positive difference, is bounded and applies to magic separately', () => {
  const { battle, actor, target } = fixture();
  assert.equal(damageChances(battle, actor, target, 'fire').luckAvoidChanceBps, 0);
  target.attributes!.effective.luck = 110;
  assert.equal(damageChances(battle, actor, target, 'fire').luckAvoidChanceBps, 500);
  target.attributes!.effective.luck = 1000;
  assert.ok(damageChances(battle, actor, target, 'physical').luckAvoidChanceBps < 1000);
  actor.attributes!.effective.luck = 1000;
  assert.equal(damageChances(battle, actor, target, 'fire').luckAvoidChanceBps, 0);
});

test('percentage armor reduces each type smoothly, caps and honors guard and attacker level', () => {
  for (const [defense, expected] of [[0, 100], [30, 50], [90, 25], [30000, 10]]) {
    const { battle, actor, target } = fixture();
    target.attributes!.effective.fireResistance = defense;
    assert.equal(applyResolvedDamage(battle, actor, target, 100, 'fire', false), expected);
  }
  const { battle, actor, target } = fixture();
  target.attributes!.effective.fireResistance = 0; target.attributes!.effective.waterResistance = 30;
  assert.equal(applyResolvedDamage(battle, actor, target, 10, 'water', false), 5);
  target.guardDefense = 30;
  assert.equal(applyResolvedDamage(battle, actor, target, 10, 'fire', false), 5);
  actor.combatLevel = 16;
  assert.equal(applyResolvedDamage(battle, actor, target, 10, 'fire', false), 6);
});

test('a physical miss and a lucky accident cause zero HP loss and skip the critical roll', () => {
  const { battle, actor, target } = fixture();
  battle.attributeRngState = seedFor(9900, 10000);
  const probe = structuredClone(battle); battleRandomBps(probe);
  assert.equal(applyResolvedDamage(battle, actor, target, 100, 'physical'), 0);
  assert.equal(battle.damageResults![0].outcome, 'miss');
  assert.equal(battle.attributeRngState, probe.attributeRngState);
  target.attributes!.effective.luck = 110;
  battle.attributeRngState = seedFor(0, 500);
  const luckyProbe = structuredClone(battle); battleRandomBps(luckyProbe);
  assert.equal(applyResolvedDamage(battle, actor, target, 100, 'fire'), 0);
  assert.equal(battle.damageResults!.at(-1)!.outcome, 'luck_avoided');
  assert.equal(battle.damageResults!.at(-1)!.hitChanceBps, 10000);
  assert.equal(battle.attributeRngState, luckyProbe.attributeRngState);
  assert.equal(target.hp, 120);
});

test('zero raw does not roll; overkill reports actual loss; a critical has the declared multiplier before rounding', () => {
  const { battle, actor, target } = fixture();
  assert.equal(applyResolvedDamage(battle, actor, target, 0, 'fire'), 0);
  assert.equal(battle.attributeRngState, 0);
  target.attributes!.effective.fireResistance = 30;
  actor.attributes!.effective.criticalChanceBps = 10000;
  assert.equal(applyResolvedDamage(battle, actor, target, 40, 'fire'), 30);
  assert.equal(battle.attributeRngState, 0);
  target.hp = 1;
  assert.equal(applyResolvedDamage(battle, actor, target, 100, 'fire'), 1);
  assert.equal(battle.damageResults!.at(-1)!.amount, 75);
});

test('simple and composed damage keep the same fraction through critical and armor', () => {
  const first = fixture(), second = fixture();
  for (const { actor, target } of [first, second]) {
    actor.attributes!.effective.magicPower = 15;
    actor.attributes!.effective.criticalChanceBps = 10000;
    target.attributes!.effective.fireResistance = 30;
  }
  damage(first.battle, first.actor, first.target, 2, 'fire');
  const skill: Skill = { ...second.battle.content.skills.find(skill => skill.id === 'ember')!, effects: [{
    id: 'fraction', recipient: 'selected', kind: 'damage', damageType: 'fire', magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: 'magicPower', weightBps: 12500 }] },
  }] };
  applySkillEffects(second.battle, second.actor, skill, second.target.id);
  assert.equal(first.target.hp, 106); assert.equal(second.target.hp, 106);
  assert.equal(second.battle.damageResults![0].raw, 18.75);
});

test('direct-match power scales simple previews and precise composed damage before armor', () => {
  const { battle, actor, target } = fixture();
  battle.matchPowerBps = 13000;
  battle.phase = 'choose'; battle.matchedElements = ['physical']; actor.skillEnergy = 30;
  actor.attributes!.effective.physicalPower = 9;
  assert.equal(skillChoices(battle, actor)[0].magnitude, 19); // floor(9 × 13/8 × 1.3), no early rounding.
  actor.attributes!.effective.criticalChanceBps = 0;
  target.attributes!.effective.fireResistance = 0;
  const skill: Skill = { ...battle.content.skills.find(skill => skill.id === 'ember')!, effects: [{
    id: 'fraction', kind: 'damage', damageType: 'fire', recipient: 'selected',
    magnitude: { unit: 'hp', terms: [{ scope: 'caster', statId: 'physicalPower', weightBps: 12500 }] },
  }] };
  assert.equal(previewSkillEffects(battle, actor, skill)[0].magnitude, 14);
  applySkillEffects(battle, actor, skill, target.id);
  assert.equal(battle.damageResults![0].raw, 14.625);
  assert.equal(target.hp, 106);
});

test('previews are per target, never consume RNG, and a miss still consumes the action and energy', () => {
  const { battle, actor, target } = fixture();
  battle.phase = 'choose'; battle.matchedElements = ['physical']; actor.skillEnergy = 30;
  const choices = skillChoices(battle, actor);
  assert.equal(choices[0].damagePreviews![0].hitChanceBps, 9885);
  const skill = { ...battle.content.skills.find(skill => skill.id === 'strike')!, effects: [{ id: 'fire', kind: 'damage' as const,
    damageType: 'fire' as const, recipient: 'selected' as const, magnitude: { unit: 'hp' as const, constant: 20 } }] };
  assert.equal(previewSkillEffects(battle, actor, skill)[0].hitChanceBps, 9885);
  assert.equal(battle.attributeRngState, 0);
  battle.attributeRngState = seedFor(9900, 10000);
  applyAction(battle, actor.id, { type: 'skill', skillId: 'strike', targetId: target.id });
  assert.equal(actor.skillEnergy, 27); assert.equal(battle.activeId, target.id); assert.equal(target.hp, 120);
});

test('saved RNG and snapshots replay identically, while legacy formulas remain unchanged', () => {
  const { battle, actor, target } = fixture();
  target.attributes!.effective.luck = 110;
  const restored: Battle = JSON.parse(JSON.stringify(battle));
  for (let hit = 0; hit < 4; hit++) {
    applyResolvedDamage(battle, actor, target, 10, 'physical');
    applyResolvedDamage(restored, restored.fighters[0], restored.fighters[1], 10, 'physical');
  }
  assert.deepEqual(restored, battle);
  delete battle.content.balance.formulas;
  actor.attributes!.effective.criticalChanceBps = 0; target.guardDefense = 0;
  target.attributes!.effective.physicalResistance = 3; target.hp = 120;
  assert.equal(applyResolvedDamage(battle, actor, target, 20, 'physical', false), 17);
  assert.equal(calculateAttributes({ definitions: defaultStatDefinitions, baseAttributes: fillBaseAttributes({}, 1, defaultStatDefinitions) }).effective.criticalBonusBps, 5000);
});

test('invalid probability bounds, missing secondary ratings and invalid factor dependencies fail validation', () => {
  const content = catalog(); content.balance.formulas!.physicalMissMinBps = 501;
  assert.equal(contentSchema.safeParse(content).success, false);
  content.balance.formulas!.physicalMissMinBps = 100; content.balance.formulas!.armorK = 0;
  assert.equal(contentSchema.safeParse(content).success, false);
  content.balance.formulas!.armorK = 30; content.statDefinitions = defaultStatDefinitions;
  assert.equal(contentSchema.safeParse(content).success, false);
});
