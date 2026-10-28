import { Injectable } from '@nestjs/common';
import { Battlefield, BattlefieldEngine, BattlefieldOptions, Cell, createBattlefield, findBattlefieldMove, moveBattlefield } from '@game/core';

/** The battlefield owns match-3 rules; the battle module owns persistence and rewards. */
@Injectable()
export class BattlefieldService implements BattlefieldEngine {
  create(options: BattlefieldOptions = {}, random = Math.random) { return createBattlefield(options, random); }
  move(field: Battlefield, from: Cell, to: Cell, random = Math.random) { return moveBattlefield(field, from, to, random); }
  possibleMove(board: Parameters<BattlefieldEngine['possibleMove']>[0]) { return findBattlefieldMove(board); }
}
