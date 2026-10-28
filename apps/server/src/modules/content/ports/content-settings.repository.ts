import { Balance, Enemy } from '@game/core';

export abstract class ContentSettingsRepository {
  abstract get(): Promise<{ balance: Balance; enemies: Enemy[] }>;
}
