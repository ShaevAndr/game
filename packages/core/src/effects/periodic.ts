import { emptyEnergy, type Battle, type Fighter } from '../types';
import { applyResolvedDamage } from '../combat/damage';
import { addLog } from '../combat/log';
import { ENERGY_CAP } from '../combat/rules';

/** Target-owned clocks, including stunned turns. No activation/proc/critical rerolls on ticks. */
export function tickPeriodicEffects(battle: Battle, target: Fighter): void {
  const effects = [...(target.activeEffects ?? [])].sort((a, b) => a.appliedSequence - b.appliedSequence || a.instanceId.localeCompare(b.instanceId));
  for (const effect of effects) {
    if (target.hp <= 0) break;
    if ((effect.kind !== 'periodic_damage' && effect.kind !== 'periodic_heal') || (target.turnsStarted ?? 0) < effect.eligibleFromTurn) continue;
    if (effect.kind === 'periodic_heal') {
      const healed = Math.max(0, Math.min(effect.magnitude, target.stats.maxHp - target.hp));
      target.hp += healed;
      addLog(battle, `${target.name}: «${effect.name}», +${healed} HP (периодическое лечение)`);
    } else {
      // The caster may have died or left a dungeon wave. Power and source level are snapshots.
      const source: Fighter = { id: effect.sourceFighterId, name: effect.sourceName ?? effect.sourceFighterId, team: -1, npc: true,
        combatLevel: effect.sourceLevel, stats: { maxHp: 1, attack: 0, defense: 0, maxEnergy: ENERGY_CAP }, hp: 1,
        inventory: [], cooldowns: {}, skillIds: [], energy: emptyEnergy() };
      applyResolvedDamage(battle, source, target, effect.magnitude, effect.damageType!, false, undefined,
        { skillId: effect.sourceSkillId, effectId: effect.definitionId, accuracyType: 'guaranteed', periodic: true });
    }
  }
}
