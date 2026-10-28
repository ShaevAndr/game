import { Battle } from '@game/core';

export abstract class BattleEvents {
  /** Best-effort notification after commit. REST always provides the authoritative snapshot. */
  abstract publish(battle: Battle): void;
}
