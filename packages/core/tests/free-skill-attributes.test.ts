import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateAttributes, applyAction, defaultBattlefieldEngine, applySkillEffects, calculateAttributes, combatStatDefinitions, createCharacter, defaultCombatFormulaRules,
  damageChances, equipmentRequirementBlockers, fillBaseAttributes, joinBattle, newBattle, previewSkillEffects, replaceFighterModifiers,
  seedContent, seedEffectSkills, skillChoices, startBattle, learnSkill, normalizeCharacter, learningBlockers, characterFighter, type Battle, type Content, type StatModifier } from '../src';
import { applyResolvedDamage } from '../src/combat/damage';
import { battleRandomBps } from '../src/combat/random';

const content: Content = { ...seedContent, effectsVersion: 1, modifierRulesVersion: 1, statDefinitions: combatStatDefinitions,
  balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules }, skills: [...seedContent.skills, ...seedEffectSkills] };
function fixture() {
  const battle = newBattle('free-skills', 'Свободный бой', 'duel', 'on-match', createCharacter('hero', 'Герой', content), content);
  joinBattle(battle, createCharacter('enemy', 'Враг', content), 1); startBattle(battle, () => 0);
  battle.attributeRngState = 0;
  return { battle, actor: battle.fighters[0], target: battle.fighters[1] };
}
const modifier = (statId: string, value: number): StatModifier => ({ id: statId, sourceId: 'test', statId, operation: 'add_flat', value });

test('a new hero has 240 HP, no skills, three skill points and five unspent attribute points; learning is explicit', () => {
  const hero = createCharacter('new', 'Новичок', content);
  assert.equal(hero.level, 1); assert.equal(hero.stats.maxHp, 240);
  assert.equal(hero.skillPoints, 3); assert.equal(hero.attributePoints, 5);
  assert.deepEqual(hero.learnedSkillIds, []); assert.deepEqual(hero.skillLevels, {});
  assert.deepEqual(normalizeCharacter(hero, content).learnedSkillIds, []);
  assert.deepEqual(characterFighter(hero, 0, content).skillIds, []);
  const strike = content.skills.find(skill => skill.id === 'strike')!;
  assert.deepEqual(learningBlockers(hero, strike, content.skills, content.statDefinitions), []);
  learnSkill(hero, strike.id, content);
  assert.equal(hero.skillPoints, 2); assert.deepEqual(hero.learnedSkillIds, ['strike']);
  assert.equal(hero.skillLevels!.strike, 1); assert.deepEqual(characterFighter(hero, 0, content).skillIds, ['strike']);
});

test('dexterity increases evasion, physical crit and both accuracies, with a smaller magic accuracy increase', () => {
  const base = fillBaseAttributes({}, 1, combatStatDefinitions);
  const first = calculateAttributes({ definitions: combatStatDefinitions, baseAttributes: base }).effective;
  const next = calculateAttributes({ definitions: combatStatDefinitions, baseAttributes: { ...base, dexterity: 30 } }).effective;
  assert.equal(next.accuracy - first.accuracy, 40); assert.equal(next.magicAccuracy - first.magicAccuracy, 20);
  assert.equal(next.evasion - first.evasion, 40);
  assert.equal(first.physicalCriticalChanceBps, 500); assert.equal(next.physicalCriticalChanceBps, 1300);
  assert.equal(next.criticalChanceBps, first.criticalChanceBps);
});

test('dexterity materially dodges both attack types and magic is easier to land', () => {
  const { battle, actor, target } = fixture();
  const first = damageChances(battle, actor, target, 'physical');
  assert.equal(first.hitChanceBps, 9231); assert.equal(damageChances(battle, actor, target, 'fire').hitChanceBps, 9765);
  replaceFighterModifiers(target, [modifier('dexterity', 90)], combatStatDefinitions);
  const physical = damageChances(battle, actor, target, 'physical'), magic = damageChances(battle, actor, target, 'fire');
  assert.equal(physical.hitChanceBps, 6500); assert.equal(magic.hitChanceBps, 8462);
  replaceFighterModifiers(actor, [modifier('dexterity', 90)], combatStatDefinitions);
  assert.ok(damageChances(battle, actor, target, 'physical').hitChanceBps > physical.hitChanceBps);
  assert.ok(damageChances(battle, actor, target, 'fire').hitChanceBps > magic.hitChanceBps);
});

test('the damage resolver rolls physical crit from dexterity separately from magical crit', () => {
  const { battle, actor, target } = fixture();
  replaceFighterModifiers(actor, [modifier('dexterity', 90)], combatStatDefinitions);
  let seed = 0;
  while (seed < 100000) {
    const probe = { attributeRngState: seed } as Battle, roll = battleRandomBps(probe);
    if (roll > 500 && roll < 4100) break;
    seed++;
  }
  assert.ok(seed < 100000);
  for (const element of ['physical', 'fire'] as const) {
    battle.attributeRngState = seed;
    applyResolvedDamage(battle, actor, target, 10, element, true, undefined, { accuracyType: 'guaranteed' });
    assert.equal(battle.damageResults!.at(-1)!.critical, element === 'physical');
    assert.equal(battle.damageResults!.at(-1)!.criticalChanceBps, element === 'physical' ? 4100 : 500);
  }
});

test('all five resistances and shield capacity scale with vitality rather than offensive primaries', () => {
  const { battle, actor } = fixture();
  const ids = ['physicalResistance', 'fireResistance', 'waterResistance', 'earthResistance', 'airResistance'];
  const base = { ...actor.attributes!.effective };
  const barrier = content.skills.find(skill => skill.id === 'earthen-barrier')!;
  const before = previewSkillEffects(battle, actor, barrier)[0].magnitude!;
  replaceFighterModifiers(actor, [modifier('strength', 100), modifier('intelligence', 100)], combatStatDefinitions);
  for (const id of ids) assert.equal(actor.attributes!.effective[id], base[id]);
  assert.equal(previewSkillEffects(battle, actor, barrier)[0].magnitude, before);
  replaceFighterModifiers(actor, [modifier('vitality', 10)], combatStatDefinitions);
  for (const id of ids) assert.equal(actor.attributes!.effective[id], 6);
  assert.ok(previewSkillEffects(battle, actor, barrier)[0].magnitude! > before);
});

test('neutral physical techniques preserve magnitude, chance and duration for any direct tile colors', () => {
  const { battle, actor } = fixture();
  const ids = ['brace', 'trip', 'disorient', 'battle-focus', 'battle-cry', 'weakening'];
  actor.skillIds = ids; actor.skillEnergy = 200; battle.phase = 'choose';
  const before = ids.map(id => previewSkillEffects(battle, actor, content.skills.find(skill => skill.id === id)!));
  battle.directMatches = { physical: 32, fire: 32, defense: 32 };
  assert.deepEqual(ids.map(id => previewSkillEffects(battle, actor, content.skills.find(skill => skill.id === id)!)), before);
  assert.ok(skillChoices(battle, actor).every(choice => choice.enabled && choice.matchPowerBps === 10000));
});

test('the real dagger requires allocated base dexterity and its scaling rewards that investment', () => {
  const dagger = seedContent.items.find(item => item.id === 'training-dagger')!;
  const first = createCharacter('hero', 'Герой', content);
  assert.match(equipmentRequirementBlockers(dagger, first.baseAttributes!, combatStatDefinitions).join(', '), /Ловкость/);
  const next = allocateAttributes(first, { dexterity: 4 }, content);
  assert.deepEqual(equipmentRequirementBlockers(dagger, next.baseAttributes!, combatStatDefinitions), []);
  assert.ok(dagger.scaledBonuses!.some(bonus => bonus.scalingStatId === 'dexterity'));
});

test('neutral debuffs actually alter both accuracy channels without changing the target base attributes', () => {
  const { battle, actor, target } = fixture();
  const base = structuredClone(target.attributeState!.baseAttributes);
  applySkillEffects(battle, actor, content.skills.find(skill => skill.id === 'disorient')!, target.id);
  assert.equal(target.attributes!.effective.accuracy, 96); assert.equal(target.attributes!.effective.magicAccuracy, 144);
  assert.deepEqual(target.attributeState!.baseAttributes, base);
});

test('a dexterity attack requires base investment and its magnitude rewards dexterity', () => {
  const hero = createCharacter('hero', 'Герой', content);
  assert.throws(() => learnSkill(hero, 'precise-thrust', content), /Ловкость/);
  const grown = allocateAttributes(hero, { dexterity: 2 }, content);
  learnSkill(grown, 'precise-thrust', content);
  assert.ok(grown.learnedSkillIds.includes('precise-thrust'));
  const { battle, actor } = fixture(), skill = content.skills.find(skill => skill.id === 'precise-thrust')!;
  const first = previewSkillEffects(battle, actor, skill)[0].magnitude!;
  replaceFighterModifiers(actor, [modifier('dexterity', 20)], combatStatDefinitions);
  assert.ok(previewSkillEffects(battle, actor, skill)[0].magnitude! > first);
  assert.equal(skill.cost, 3);
});


test('cell HP loss ignores formula defenses and shields, without consuming combat randomness', () => {
  const { battle, actor, target } = fixture();
  applySkillEffects(battle, target, content.skills.find(skill => skill.id === 'earthen-barrier')!, target.id);
  const shield = structuredClone(target.activeEffects!.filter(effect => effect.kind === 'shield'));
  assert.ok(shield.length > 0);
  replaceFighterModifiers(target, [modifier('vitality', 100), modifier('dexterity', 100), modifier('luck', 100)], combatStatDefinitions);
  const before = target.hp, rng = battle.attributeRngState;
  applyAction(battle, actor.id, { type: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 }, targetId: target.id }, () => 0, {
    ...defaultBattlefieldEngine,
    move: field => ({ ...structuredClone(field), direct: { count: 3, byType: { fire: 3 } }, generated: { count: 4, byType: { water: 4 } },
      total: { count: 7, byType: { fire: 3, water: 4 } }, cascades: 1, steps: [], shuffled: false, regeneration: null }),
  });
  assert.equal(target.hp, before - 7); assert.equal(battle.attributeRngState, rng);
  const remaining = target.activeEffects!.filter(effect => effect.kind === 'shield');
  assert.equal(remaining.length, shield.length);
  assert.equal(remaining[0].kind === 'shield' && remaining[0].remainingShield, shield[0].kind === 'shield' && shield[0].remainingShield);
});
