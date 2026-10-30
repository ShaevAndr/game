import { StatDefinition } from '@game/core';

export abstract class CharacteristicsRepository {
  abstract list(): Promise<StatDefinition[]>;
}
