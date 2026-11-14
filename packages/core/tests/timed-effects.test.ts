import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applySkillEffects, combatStatDefinitions, contentSchema, createCharacter, defaultCombatFormulaRules, expireMatchedTurn,
  joinBattle, newBattle, previewSkillEffects, seedContent, seedEffectSkills, startBattle, type Battle, type Content, type Skill, type SkillEffect } from '../src';
import { applyResolvedDamage } from '../src/combat/damage';

const content: Content = { ...seedContent, effectsVersion: 1, modifierRulesVersion: 1, statDefinitions: combatStatDefinitions,
  balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules }, skills: [...seedContent.skills, ...seedEffectSkills] };
function fixture() {
  const battle = newBattle('timed', 'Эффекты', 'duel', 'on-match', createCharacter('hero', 'Герой', content), content);
  joinBattle(battle, createCharacter('enemy', 'Враг', content), 1); startBattle(battle, () => 0);
  battle.attributeRngState = 0;
  return { battle, actor: battle.fighters[0], target: battle.fighters[1] };
}
function custom(effects: SkillEffect[], ally = false): Skill {
  return { ...seedEffectSkills[0], id: 'test-timed', targeting: ally ? { kind: 'ally_single', includeSelf: true } : { kind: 'enemy_single' }, effects };
}
const hp = (amount: number) => ({ unit: 'hp' as const, constant: amount, min: 0, terms: [{ scope: 'caster' as const, statId: 'magicPower', weightBps: 0 }] });
const shield = (id: string, amount: number, durationTurns = 2): SkillEffect => ({ id, kind: 'shield', recipient: 'selected', magnitude: hp(amount), durationTurns });
const dot = (amount: number, durationTurns = 3): SkillEffect => ({ id: 'burn', kind: 'periodic_damage', recipient: 'selected', magnitude: hp(amount), durationTurns, damageType: 'fire' });

test('the complete energy-200 catalog validates and all timed skills have deliberate targets', () => {
  assert.ok(contentSchema.safeParse(content).success);
  assert.equal(content.balance.combat!.energyCap, 200);
  const invalid = structuredClone(content);
  invalid.skills.find(skill => skill.id === 'burning-brand')!.targeting = { kind: 'self' };
  assert.equal(contentSchema.safeParse(invalid).success, false);
});

test('armor resolves before shields; full absorption can cause zero HP loss', () => {
  const { battle, actor, target } = fixture();
  target.attributes!.effective.physicalResistance = 30;
  applySkillEffects(battle, actor, custom([shield('barrier', 40)]), target.id);
  applyResolvedDamage(battle, actor, target, 60, 'physical', false, undefined, { periodic: true });
  assert.equal(target.hp, 120);
  assert.deepEqual({ amount: battle.damageResults![0].amount, absorbed: battle.damageResults![0].absorbed, hpLoss: battle.damageResults![0].hpLoss }, { amount: 30, absorbed: 30, hpLoss: 0 });
  assert.equal(target.activeEffects![0].kind === 'shield' && target.activeEffects![0].remainingShield, 10);
  applyResolvedDamage(battle, actor, target, 60, 'physical', false, undefined, { periodic: true });
  assert.equal(target.hp, 100); assert.equal(target.activeEffects!.length, 0);
});

test('shield absorption uses nearest expiry first and refresh replaces rather than adds capacity', () => {
  const { battle, actor, target } = fixture(); target.attributes!.effective.physicalResistance = 0;
  applySkillEffects(battle, actor, custom([shield('long', 20, 3), shield('short', 10, 1)]), target.id);
  applyResolvedDamage(battle, actor, target, 15, 'physical', false, undefined, { periodic: true });
  assert.equal(target.activeEffects!.length, 1);
  assert.equal(target.activeEffects![0].kind === 'shield' && target.activeEffects![0].remainingShield, 15);
  applySkillEffects(battle, actor, custom([shield('long', 20, 3)]), target.id);
  assert.equal(target.activeEffects![0].kind === 'shield' && target.activeEffects![0].remainingShield, 20);
});

test('periodic damage ticks once per target turn, survives JSON and keeps the casting snapshot', () => {
  const first = fixture(); first.target.attributes!.effective.fireResistance = 0;
  applySkillEffects(first.battle, first.actor, custom([dot(8)]), first.target.id);
  const restored: Battle = JSON.parse(JSON.stringify(first.battle));
  for (const battle of [first.battle, restored]) {
    battle.fighters[0].attributes!.effective.magicPower = 1000;
    expireMatchedTurn(battle); assert.equal(battle.fighters[1].hp, 112);
    expireMatchedTurn(battle); expireMatchedTurn(battle); assert.equal(battle.fighters[1].hp, 104);
    expireMatchedTurn(battle); expireMatchedTurn(battle); assert.equal(battle.fighters[1].hp, 96);
    expireMatchedTurn(battle); assert.equal(battle.fighters[1].activeEffects!.length, 0);
    expireMatchedTurn(battle); assert.equal(battle.fighters[1].hp, 96);
  }
  assert.deepEqual(first.battle, restored);
});

test('regeneration respects max HP and is not consumed on the casting turn', () => {
  const { battle, actor } = fixture(); actor.hp = 100;
  applySkillEffects(battle, actor, custom([{ id: 'regen', kind: 'periodic_heal', recipient: 'selected', magnitude: hp(15), durationTurns: 2 }], true), actor.id);
  expireMatchedTurn(battle); assert.equal(actor.hp, 100); assert.equal(actor.activeEffects![0].remainingTurns, 2);
  expireMatchedTurn(battle); assert.equal(actor.hp, 115);
  expireMatchedTurn(battle); expireMatchedTurn(battle); assert.equal(actor.hp, 120);
  expireMatchedTurn(battle); assert.equal(actor.activeEffects!.length, 0);
});

test('a lethal tick finishes combat before the target can act and dead targets cannot be healed back', () => {
  const { battle, actor, target } = fixture(); target.hp = 1;
  applySkillEffects(battle, actor, custom([dot(100)]), target.id);
  expireMatchedTurn(battle);
  assert.equal(battle.status, 'finished'); assert.equal(battle.winner, 0); assert.equal(target.hp, 0);
  assert.equal(target.activeEffects!.length, 0); assert.equal(battle.activeId, null);
});

test('stunned turns tick periodic effects; ticks never reroll activation, critical, luck or flat bonuses', () => {
  const { battle, actor, target } = fixture(); target.attributes!.effective.fireResistance = 0;
  target.attributes!.effective.luck = 1000;
  applySkillEffects(battle, actor, custom([dot(8), { id: 'control', kind: 'stun', recipient: 'selected', durationTurns: 1 }]), target.id);
  const rng = battle.attributeRngState, results = battle.effectResults!.length;
  expireMatchedTurn(battle);
  assert.equal(battle.activeId, actor.id); assert.equal(target.hp, 112);
  assert.equal(battle.attributeRngState, rng); assert.equal(battle.effectResults!.length, results);
  assert.equal(battle.damageResults![0].periodic, true); assert.equal(battle.damageResults![0].critical, false);
});

test('cleanse removes periodic damage and purge removes shields before a subsequent hit', () => {
  const { battle, actor, target } = fixture();
  applySkillEffects(battle, actor, custom([dot(8)]), target.id);
  applySkillEffects(battle, target, custom([{ id: 'cleanse', kind: 'dispel', recipient: 'selected', polarityToRemove: 'debuff', maxCount: 1 }], true), target.id);
  assert.equal(target.activeEffects!.length, 0);
  applySkillEffects(battle, target, custom([shield('barrier', 40)], true), target.id);
  applySkillEffects(battle, actor, custom([{ id: 'purge', kind: 'dispel', recipient: 'selected', polarityToRemove: 'buff', maxCount: 1 }]), target.id);
  assert.equal(target.activeEffects!.length, 0);
});

test('match power strengthens shields and periodic magnitude once, never their duration', () => {
  const { battle, actor } = fixture(); battle.matchPowerBps = 16000;
  const preview = previewSkillEffects(battle, actor, custom([shield('barrier', 10)], true))[0];
  assert.equal(preview.magnitude, 16); assert.equal(preview.durationTurns, 2);
});

test('independent shields have a bounded count and replace the oldest instance', () => {
  const { battle, actor, target } = fixture();
  const skill = custom([{ ...shield('barrier', 10), stacking: 'independent', maxStacks: 2 } as SkillEffect]);
  for (let i = 0; i < 3; i++) applySkillEffects(battle, actor, skill, target.id);
  assert.deepEqual(target.activeEffects!.map(effect => effect.appliedSequence), [2, 3]);
});

test('a shield expires by target turns and a periodic effect survives its source dying', () => {
  const { battle, actor, target } = fixture();
  applySkillEffects(battle, actor, custom([shield('barrier', 10, 1)], true), actor.id);
  expireMatchedTurn(battle); expireMatchedTurn(battle); expireMatchedTurn(battle);
  assert.equal(actor.activeEffects!.length, 0);
  // Keep an allied survivor so the battle continues after the original caster dies.
  battle.fighters.push({ ...structuredClone(actor), id: 'ally', name: 'Союзник', activeEffects: [] });
  applySkillEffects(battle, actor, custom([dot(8)]), target.id);
  actor.hp = 0;
  const before = target.hp;
  while (battle.activeId !== target.id) expireMatchedTurn(battle);
  expireMatchedTurn(battle); expireMatchedTurn(battle);
  assert.ok(target.hp < before);
});

test('catalog rejects a shared stack key with incompatible timed effects', () => {
  const invalid = structuredClone(content);
  const burn = invalid.skills.find(skill => skill.id === 'burning-brand')!.effects![0];
  const barrier = invalid.skills.find(skill => skill.id === 'earthen-barrier')!.effects![0];
  Object.assign(burn, { stackKey: 'conflict' }); Object.assign(barrier, { stackKey: 'conflict' });
  assert.equal(contentSchema.safeParse(invalid).success, false);
});

test('strengthening a multiply debuff stays below one and respects the expression limits', () => {
  const { battle, actor, target } = fixture(); battle.matchPowerBps = 16000;
  const skill = custom([{ id: 'weak', kind: 'stat_modifier', recipient: 'selected', statId: 'physicalPower', operation: 'multiply', polarity: 'debuff', magnitude: { unit: 'basis_points', constant: 8000, min: 0 }, durationTurns: 2 }]);
  assert.equal(previewSkillEffects(battle, actor, skill)[0].magnitude, 6800);
  applySkillEffects(battle, actor, skill, target.id);
  assert.ok(target.attributes!.effective.physicalPower < actor.attributes!.effective.physicalPower);
});

test('invalid casts roll back energy and persisted periodic state', () => {
  const { battle, actor, target } = fixture();
  actor.skillIds.push('burning-brand'); actor.skillEnergy = 100;
  battle.phase = 'choose'; battle.matchedElements = ['fire'];
  const before = structuredClone(battle);
  assert.throws(() => applyAction(battle, actor.id, { type: 'skill', skillId: 'burning-brand', targetId: actor.id }));
  assert.deepEqual(battle, before);
  applyAction(battle, actor.id, { type: 'skill', skillId: 'burning-brand', targetId: target.id });
  assert.equal(battle.fighters[0].skillEnergy, 60);
  assert.ok(battle.fighters[1].hp < 120);
});
