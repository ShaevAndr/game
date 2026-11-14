import type { Fighter } from '../types';
import type { ActiveTimedEffect } from './types';

/** Armor resolves first. Shields absorb in stable expiry/application order. */
export function absorbShields(target: Fighter, amount: number): number {
  let remaining = amount;
  const shields = (target.activeEffects ?? []).filter((effect): effect is ActiveTimedEffect => effect.kind === 'shield')
    .sort((a, b) => a.remainingTurns - b.remainingTurns || a.appliedSequence - b.appliedSequence || a.instanceId.localeCompare(b.instanceId));
  for (const shield of shields) {
    const absorbed = Math.min(remaining, shield.remainingShield ?? 0);
    shield.remainingShield = (shield.remainingShield ?? 0) - absorbed;
    remaining -= absorbed;
    if (!remaining) break;
  }
  if (shields.length) target.activeEffects = target.activeEffects!.filter(effect => effect.kind !== 'shield' || (effect.remainingShield ?? 0) > 0);
  return amount - remaining;
}
