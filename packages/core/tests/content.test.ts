import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, characterFighter, contentSchema, createCharacter, elements, gainExperience, joinBattle, learnSkill, possibleMove, rules, seedContent, startBattle } from '../src';

test('each branch has six skills and two distinct playable templates', () => {
  assert.ok(contentSchema.safeParse(seedContent).success);
  for (const element of elements) {
    assert.equal(seedContent.skills.filter(s => s.element === element).length, 6);
    const templates = seedContent.characterTemplates.filter(t => t.element === element);
    assert.equal(templates.length, 2);
    assert.equal(new Set(templates.map(t => t.skillId)).size, 2);
    for (const template of templates) {
      const hero = createCharacter(template.id, template.name, seedContent, template.id);
      assert.equal(hero.templateId, template.id);
      assert.deepEqual(hero.learnedSkillIds, ['strike']);
      assert.equal(hero.skillPoints, 2);
      assert.equal(hero.level, 1);
      assert.equal(characterFighter(hero, 0, seedContent).skillIds.length, 1);
    }
  }
});

test('template creation preserves defaults, rejects unknown types and isolates character state', () => {
  const before = structuredClone(seedContent);
  const first = createCharacter('first', 'Первый', seedContent, 'druid');
  const second = createCharacter('second', 'Второй', seedContent);
  assert.deepEqual(second.learnedSkillIds, ['strike']); assert.equal(second.skillPoints, 2);
  assert.equal(second.templateId, undefined);
  first.stats.attack++; first.inventory[0].quantity--; first.energy.earth++;
  assert.deepEqual(seedContent, before);
  assert.deepEqual(second.stats, before.balance.characterStats);
  assert.deepEqual(second.inventory, before.balance.starterItems);
  assert.throws(() => createCharacter('bad', 'Ошибка', seedContent, 'unknown'), /не найден/);
});

test('all branches can be learned through normal level and stat growth', () => {
  for (const element of elements) {
    const hero = createCharacter(element, element, seedContent);
    gainExperience(hero, 1350, seedContent.balance.progression);
    const remaining = seedContent.skills.filter(s => s.element === element && !s.learning.starter);
    while (remaining.length) {
      const index = remaining.findIndex(s => s.learning.prerequisites.every(id => hero.learnedSkillIds.includes(id)));
      assert.ok(index >= 0, `unreachable ${element} branch`);
      learnSkill(hero, remaining.splice(index, 1)[0].id, seedContent);
    }
    assert.ok(hero.skillPoints >= 0);
  }
});

test('legacy content snapshots and invalid template references are handled', () => {
  const legacy = structuredClone(seedContent); Reflect.deleteProperty(legacy, 'characterTemplates');
  assert.deepEqual(contentSchema.parse(legacy).characterTemplates, []);
  for (const skillId of ['missing', 'strike', 'inferno', 'spring']) {
    const content = structuredClone(seedContent); content.characterTemplates[0].skillId = skillId;
    assert.equal(contentSchema.safeParse(content).success, false, skillId);
  }
  const duplicate = structuredClone(seedContent); duplicate.characterTemplates.push(duplicate.characterTemplates[0]);
  assert.equal(contentSchema.safeParse(duplicate).success, false);
  const unaffordable = structuredClone(seedContent); unaffordable.balance.progression.startingSkillPoints = 0;
  assert.equal(contentSchema.safeParse(unaffordable).success, false);
});
