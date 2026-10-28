import { CharacterTemplate } from '@game/core';

export abstract class CharacterTemplatesRepository {
  abstract list(): Promise<CharacterTemplate[]>;
}
