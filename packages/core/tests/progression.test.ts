import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Character, characterFighter, contentSchema, experienceToNextLevel, gainExperience, learnSkill, learningBlockers, newBattle, normalizeCharacter, seedContent, emptyEnergy, victoryRecipients } from '../src';

const config = seedContent.balance.progression;
function hero(): Character { return { id: 'hero', name: 'Hero', level: 1, experience: 0, skillPoints: 2, learnedSkillIds: ['strike'], stats: { ...seedContent.balance.characterStats }, energy: emptyEnergy(), inventory: [], createdAt: new Date().toISOString() }; }
test('victory experience carries over, awards points and grows stats at level up', () => {
  const c = hero(); assert.equal(gainExperience(c, 99, config), 0); assert.equal(c.level, 1); assert.equal(c.skillPoints, 2);
  assert.equal(gainExperience(c, 26, config), 1); assert.equal(c.experience, 25); assert.equal(c.level, 2); assert.equal(c.skillPoints, 4);
  assert.deepEqual(c.stats, { maxHp: 132, attack: 10, defense: 4, maxEnergy: 30 }); assert.equal(experienceToNextLevel(c.level, config), 150);
});
test('one reward can advance several levels and preserves excess experience', () => {
  const c = hero(); assert.equal(gainExperience(c, 460, config), 3); assert.equal(c.level, 4); assert.equal(c.experience, 10); assert.equal(c.skillPoints, 8); assert.equal(c.stats.attack, 14);
});
test('zero or invalid experience cannot change the character', () => {
  const c = hero(), before = structuredClone(c); assert.equal(gainExperience(c, 0, config), 0);
  for (const amount of [-1, 0.5, NaN, Infinity]) assert.throws(() => gainExperience(c, amount, config)); assert.deepEqual(c, before);
});
test('studying a skill deducts its point cost once and adds the skill', () => {
  const c = hero(); learnSkill(c, 'ember', seedContent); assert.equal(c.skillPoints, 1); assert.deepEqual(c.learnedSkillIds, ['strike', 'ember']);
  assert.throws(() => learnSkill(c, 'ember', seedContent), /уже изучен/); assert.equal(c.skillPoints, 1);
});
test('all four requirements are checked independently without partial spending', () => {
  const c = hero(); c.skillPoints = 0; c.stats.attack = 0;
  const skill = seedContent.skills.find(s => s.id === 'fireball')!;
  const reasons = learningBlockers(c, skill, seedContent.skills); assert.equal(reasons.length, 4);
  const before = structuredClone(c); assert.throws(() => learnSkill(c, 'fireball', seedContent)); assert.deepEqual(c, before);
});
test('high level cannot bypass prerequisites', () => { const c = hero(); gainExperience(c, 1000, config); assert.throws(() => learnSkill(c, 'fireball', seedContent), /Сначала изучите/); });
test('learned prerequisites and enough points cannot bypass stat requirements', () => {
  const c = hero(); gainExperience(c, 100, config); learnSkill(c, 'ember', seedContent); c.stats.attack = 9;
  assert.throws(() => learnSkill(c, 'fireball', seedContent), /Атака/); c.stats.attack = 10; learnSkill(c, 'fireball', seedContent); assert.ok(c.learnedSkillIds.includes('fireball'));
});
test('unknown skill does not spend points', () => { const c = hero(); assert.throws(() => learnSkill(c, 'unknown', seedContent), /не найден/); assert.equal(c.skillPoints, 2); });
test('learning supports several required predecessors', () => { const content = structuredClone(seedContent); const c = hero(); gainExperience(c, 1000, config); const skill = content.skills.find(s => s.id === 'fireball')!; skill.learning.prerequisites = ['ember', 'pebble']; learnSkill(c, 'ember', content); assert.throws(() => learnSkill(c, 'fireball', content), /Каменный осколок/); learnSkill(c, 'pebble', content); learnSkill(c, 'fireball', content); });
test('battle fighters receive only learned skills, and keep a snapshot', () => {
  const c = hero(), f = characterFighter(c, 0, seedContent); assert.deepEqual(f.skillIds, ['strike']); learnSkill(c, 'ember', seedContent); assert.deepEqual(f.skillIds, ['strike']); assert.deepEqual(characterFighter(c, 0, seedContent).skillIds, ['strike', 'ember']);
});
test('legacy normalization preserves level, stats and existing progress including zero points', () => {
  const old = hero() as Partial<Character>; delete old.experience; delete old.skillPoints; delete old.learnedSkillIds;
  const c = normalizeCharacter(old as Character, seedContent); assert.equal(c.level, 1); assert.equal(c.experience, 0); assert.equal(c.skillPoints, 4); assert.deepEqual(c.learnedSkillIds, ['strike']); assert.deepEqual(c.stats, old.stats);
  c.skillPoints = 0; c.experience = 37; c.learnedSkillIds.push('ember'); c.skillLevels = { strike: 1, ember: 1 }; assert.deepEqual(normalizeCharacter(c, seedContent), c);
});
test('victory recipients include fallen allies, exclude losers and NPCs', () => {
  const c = hero(), b = newBattle('battle', 'test', 'team', 'before', c, seedContent); b.status = 'finished'; b.winner = 0;
  b.fighters.push({ ...characterFighter({ ...c, id: 'fallen' }, 0, seedContent), hp: 0 }, characterFighter({ ...c, id: 'loser' }, 1, seedContent), { ...characterFighter({ ...c, id: 'npc' }, 0, seedContent), npc: true });
  assert.deepEqual(victoryRecipients(b), ['fallen', 'hero']); b.winner = null; assert.deepEqual(victoryRecipients(b), []); b.winner = 0; b.status = 'active'; assert.deepEqual(victoryRecipients(b), []);
});
test('content rejects missing predecessors, cyclic branches and inaccessible starter attacks', () => {
  const missing = structuredClone(seedContent); missing.skills.find(s => s.id === 'ember')!.learning.prerequisites = ['unknown']; assert.equal(contentSchema.safeParse(missing).success, false);
  const cycle = structuredClone(seedContent); cycle.skills.find(s => s.id === 'ember')!.learning.prerequisites = ['fireball']; assert.equal(contentSchema.safeParse(cycle).success, false);
  const starter = structuredClone(seedContent); starter.skills[0].learning.level = 2; assert.equal(contentSchema.safeParse(starter).success, false);
});
