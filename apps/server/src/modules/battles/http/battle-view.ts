import type { Battle } from '@game/core';

/** Random stream and unresolved cascades belong only to persistence. */
export function battleView(battle: Battle): Omit<Battle, 'attributeRngState' | 'pendingBattlefield'> {
  const { attributeRngState: _rng, pendingBattlefield: _pending, ...view } = battle;
  return view;
}
