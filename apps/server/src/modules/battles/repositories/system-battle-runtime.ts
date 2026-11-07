import { Injectable } from '@nestjs/common';
import { BattleRuntime } from '../ports/battle-runtime';

@Injectable()
export class SystemBattleRuntime extends BattleRuntime {
  now() { return Date.now(); }
  random() { return Math.random(); }
}
