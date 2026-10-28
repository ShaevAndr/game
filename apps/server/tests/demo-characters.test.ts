import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Character, createCharacter, experienceToNextLevel, gainExperience, learnSkill, seedContent } from '@game/core';
import characters from '../src/infrastructure/database/migrations/003-demo-characters.json';

test('migration contains ten unique level 10 heroes with valid learned skills and remaining points', () => {
  assert.equal(characters.length, 10); assert.equal(new Set(characters.map(c => c.id)).size, 10);
  assert.equal(new Set(characters.map(c => c.templateId)).size, 10);
  const legacy = structuredClone(seedContent);
  legacy.balance.progression.startingSkillPoints = 2;
  legacy.balance.progression.statGrowth.maxEnergy = 2;
  const experience = Array.from({ length: 9 }, (_, i) => experienceToNextLevel(i + 1, legacy.balance.progression)).reduce((a, b) => a + b, 0);
  for (const snapshot of characters) {
    const character: Character = snapshot;
    const reconstructed = createCharacter(character.id, character.name, legacy, character.templateId);
    gainExperience(reconstructed, experience, legacy.balance.progression);
    for (const id of character.learnedSkillIds) if (!reconstructed.learnedSkillIds.includes(id)) learnSkill(reconstructed, id, legacy);
    assert.equal(character.level, 10); assert.ok(character.learnedSkillIds.length >= 6);
    assert.deepEqual(character.stats, reconstructed.stats);
    assert.equal(character.skillPoints, reconstructed.skillPoints);
    assert.equal(character.experience, 0);
    assert.deepEqual(new Set(character.learnedSkillIds), new Set(reconstructed.learnedSkillIds));
    assert.ok(character.skillPoints > 0);
  }
});
