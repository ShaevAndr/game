import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Character, createCharacter, combatStatDefinitions, defaultCombatFormulaRules, seedEffectSkills, seedContent } from '@game/core';
import characters from '../src/infrastructure/database/seeds/demo-characters.json';

test('migration contains ten unique level 1 heroes with no skills and unspent starting points', () => {
  assert.equal(characters.length, 10); assert.equal(new Set(characters.map(c => c.id)).size, 10);
  assert.equal(new Set(characters.map(c => c.templateId)).size, 10);
  const content = structuredClone({ ...seedContent, statDefinitions: combatStatDefinitions, balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules }, skills: [...seedContent.skills, ...seedEffectSkills] });
  for (const snapshot of characters) {
    const character = snapshot as unknown as Character;
    const reconstructed = createCharacter(character.id, character.name, content, character.templateId);
    assert.equal(character.level, 1); assert.deepEqual(character.learnedSkillIds, []);
    assert.deepEqual(character.skillLevels, {});
    assert.equal(character.attributePoints, 5); assert.equal(character.attributeRevision, 0);
    assert.deepEqual(character.baseAttributes, reconstructed.baseAttributes);
    assert.equal(character.stats.maxHp, 240); assert.equal(character.skillPoints, 3);
    assert.deepEqual(character.stats, reconstructed.stats);
    assert.equal(character.skillPoints, reconstructed.skillPoints);
    assert.equal(character.experience, 0);
    assert.deepEqual(new Set(character.learnedSkillIds), new Set(reconstructed.learnedSkillIds));
    assert.ok(character.skillPoints >= 0);
    for (const itemId of ['woodcutting-axe', 'mining-pick'])
      assert.equal(character.inventory.filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0), 1);
  }
});
