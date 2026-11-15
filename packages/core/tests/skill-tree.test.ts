import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentSchema, createCharacter, grantSkill, learnSkill, learningBlockers, seedContent, seedEffectSkills, skillTreeNodes,
  branchLearningRequirements, combatStatDefinitions, type Content } from '../src';

const content: Content = { ...seedContent, skills: [...seedContent.skills, ...seedEffectSkills] };
const catalog: Content = { ...content, statDefinitions: combatStatDefinitions };
const advanced = () => { const hero = createCharacter('hero', 'Герой', content); hero.level = 10; hero.skillPoints = 40; hero.stats.attack = 30; hero.stats.defense = 20; return hero; };

test('every seeded skill has an emblem and membership; each school has one origin and forks', () => {
  assert.equal(contentSchema.safeParse(catalog).success, true);
  assert.ok(content.skills.every(skill => skill.icon && skill.learning.branch && skill.learning.prerequisites.length === 0));
  const nodes = skillTreeNodes(content.skills);
  for (const element of ['fire', 'water', 'earth', 'air', 'physical']) {
    const school = nodes.filter(node => node.element === element);
    const roots = school.filter(node => !node.parents.length);
    assert.equal(roots.length, 1);
    assert.ok(school.filter(node => node.parents.includes(roots[0].id)).length >= 2);
  }
  assert.equal(nodes.flatMap(node => node.skills).length, content.skills.length);
});

test('any member of the previous node opens every alternative in the child; siblings need not be learned', () => {
  const hero = advanced(); learnSkill(hero, 'phoenix-warmth', content);
  learnSkill(hero, 'burning-brand', content); // no ember, no fireball
  learnSkill(hero, 'inferno', content);
  assert.ok(!hero.learnedSkillIds.includes('ember')); assert.ok(!hero.learnedSkillIds.includes('fireball'));
  assert.deepEqual(hero.learnedSkillIds, ['phoenix-warmth', 'burning-brand', 'inferno']);
});

test('neighbouring nodes do not unlock one another or exclude other paths', () => {
  const hero = advanced(); learnSkill(hero, 'ember', content); learnSkill(hero, 'fireball', content);
  assert.ok(learningBlockers(hero, content.skills.find(skill => skill.id === 'phoenix-heart')!, content.skills).some(reason => reason.includes('Путь феникса')));
  learnSkill(hero, 'healing-flame', content); learnSkill(hero, 'phoenix-heart', content);
  assert.ok(hero.learnedSkillIds.includes('fireball')); assert.ok(hero.learnedSkillIds.includes('phoenix-heart'));
});

test('neither a high level, other schools, nor upgrades bypass an unopened parent node', () => {
  const hero = advanced(); learnSkill(hero, 'spring', content);
  const skill = content.skills.find(skill => skill.id === 'inferno')!, before = structuredClone(hero);
  assert.throws(() => learnSkill(hero, skill.id, content), /любой навык узла/); assert.deepEqual(hero, before);
  assert.equal(branchLearningRequirements(hero.learnedSkillIds, skill, content.skills)[0].met, false);
});

test('branch access preserves point, level and stat checks and failed purchases spend nothing', () => {
  const hero = createCharacter('hero', 'Герой', content);
  learnSkill(hero, 'ember', content); const skill = content.skills.find(skill => skill.id === 'fireball')!;
  hero.skillPoints = 0; hero.stats.attack = 0;
  const before = structuredClone(hero), reasons = learningBlockers(hero, skill, content.skills);
  assert.equal(reasons.length, 3); assert.ok(reasons.some(reason => reason.includes('уровень')));
  assert.throws(() => learnSkill(hero, skill.id, content)); assert.deepEqual(hero, before);
});

test('trusted grants remain rank-one grants and count as a learned node member', () => {
  const hero = advanced(); hero.skillPoints = 2;
  grantSkill(hero, 'burning-brand', content);
  learnSkill(hero, 'inferno', content);
  assert.equal(hero.skillPoints, 0); assert.equal(hero.skillLevels!.inferno, 1);
});

test('content rejects missing, cyclic, cross-school and inconsistent branch declarations', () => {
  for (const change of [
    (c: Content) => { c.skills.find(skill => skill.id === 'fireball')!.learning.branch!.parents = ['missing-node']; },
    (c: Content) => { for (const skill of c.skills.filter(skill => skill.learning.branch?.id === 'fire-origin')) skill.learning.branch!.parents = ['fire-pressure']; },
    (c: Content) => { for (const skill of c.skills.filter(skill => skill.learning.branch?.id === 'fire-pressure')) skill.learning.branch!.parents = ['water-origin']; },
    (c: Content) => { c.skills.find(skill => skill.id === 'burning-brand')!.learning.branch!.name = 'Different name'; },
  ]) {
    const invalid = structuredClone(catalog); change(invalid); assert.equal(contentSchema.safeParse(invalid).success, false);
  }
});

test('content catches deadlocks between branch alternatives and strict prerequisites', () => {
  const invalid = structuredClone(catalog);
  for (const skill of invalid.skills.filter(skill => skill.learning.branch?.id === 'fire-origin')) skill.learning.prerequisites = ['fireball'];
  assert.equal(contentSchema.safeParse(invalid).success, false);
});
