import { Skill } from '@game/core';

export abstract class SkillsCatalogRepository {
  abstract list(): Promise<Skill[]>;
}
