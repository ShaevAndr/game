import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, characterFighter, contentSchema, createCharacter, elements, gainExperience, joinBattle, learnSkill, newBattle, possibleMove, rules, seedContent, startBattle } from '../src';

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
      assert.deepEqual(hero.learnedSkillIds, ['strike', template.skillId]);
      assert.equal(hero.skillPoints, 1);
      assert.equal(hero.level, 1);
      assert.equal(characterFighter(hero, 0, seedContent).skillIds.length, 2);
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
    gainExperience(hero, 700, seedContent.balance.progression);
    const remaining = seedContent.skills.filter(s => s.element === element && !s.learning.starter);
    while (remaining.length) {
      const index = remaining.findIndex(s => s.learning.prerequisites.every(id => hero.learnedSkillIds.includes(id)));
      assert.ok(index >= 0, `unreachable ${element} branch`);
      learnSkill(hero, remaining.splice(index, 1)[0].id, seedContent);
    }
    assert.ok(hero.skillPoints >= 0);
  }
});

for (const rule of rules) test(`every skill works in combat under ${rule}`, () => {
  for (const skill of seedContent.skills) {
    const hero = createCharacter('hero', 'Герой', seedContent), enemy = createCharacter('enemy', 'Враг', seedContent);
    hero.learnedSkillIds = seedContent.skills.map(s => s.id);
    const battle = newBattle('battle', 'Проверка', 'duel', rule, hero, seedContent);
    joinBattle(battle, enemy, 1); startBattle(battle);
    const actor = battle.fighters[0], victim = skill.effect === 'heal' ? actor : battle.fighters[1];
    if (rule === 'on-match') applyAction(battle, actor.id, { type: 'swap', ...possibleMove(battle.board)!, targetId: 'enemy' });
    actor.energy[skill.element] = actor.stats.maxEnergy;
    victim.hp = skill.effect === 'heal' ? 1 : victim.stats.maxHp;
    const hp = victim.hp, energy = actor.energy[skill.element], bonus = rule === 'on-match' ? battle.pendingMatch * seedContent.balance.damagePerTile : 0;
    applyAction(battle, actor.id, { type: 'skill', skillId: skill.id, targetId: victim.id });
    const expected = skill.effect === 'heal' ? Math.min(victim.stats.maxHp, hp + skill.power + bonus) : Math.max(0, hp - Math.max(1, skill.power + bonus + actor.stats.attack - victim.stats.defense));
    assert.equal(victim.hp, expected, skill.id);
    assert.equal(actor.energy[skill.element], energy - skill.cost, skill.id);
    assert.equal(actor.cooldowns[skill.id], skill.cooldown ? skill.cooldown + 1 : 0, skill.id);
    assert.equal(battle.usedSkill, rule !== 'on-match', skill.id);
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
