import { ModifierDefinition } from '@game/core';
export abstract class ModifierDefinitionsRepository {
  abstract list(): Promise<ModifierDefinition[]>;
}
