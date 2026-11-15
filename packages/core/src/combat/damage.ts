import type { Battle, Element, Fighter } from '../types';
import { addLog } from './log';
import { battleRandomBps } from './random';
import { resolveDamage, type DamageContext } from './resolve-damage';
import { absorbShields } from '../effects/shields';
import { rational, type Rational } from '../attributes/rational';
import { matchPowerBps } from './match-power';
import { criticalChanceBps } from './formulas';

export function damage(b: Battle, actor: Fighter, victim: Fighter, power: number, element: Element = 'physical', skillId?: string) {
  const multiplier = matchPowerBps(b, b.content.skills.find(skill => skill.id === skillId) ?? { element });
  if (b.content.balance.formulas) {
    const attack = actor.attributes?.effective[element === 'physical' ? 'physicalPower' : 'magicPower'] ?? actor.stats.attack;
    const reference = b.content.balance.attributes?.skillReferencePower ?? 8;
    return resolveDamage(b, actor, victim, rational(BigInt(attack) * BigInt(reference + power) * BigInt(multiplier), reference * 10000), element, true, { skillId });
  }
  const guard = victim.guardDefense ?? 0;
  if (b.content.statDefinitions) {
    const attack = actor.attributes?.effective[element === 'physical' ? 'physicalPower' : 'magicPower'] ?? actor.stats.attack;
    const defense = victim.attributes?.effective[element === 'physical' ? 'physicalResistance' : `${element}Resistance`] ?? victim.stats.defense;
    const critical = battleRandomBps(b) < (criticalChanceBps(actor, element));
    const bonus = critical ? actor.attributes!.effective.criticalBonusBps : 0;
    // Existing skill power is a coefficient relative to the reference power 8, never free damage.
    const reference = b.content.balance.attributes?.skillReferencePower ?? 8;
    const amount = Math.max(1, Number(BigInt(attack) * BigInt(reference + power) * BigInt(multiplier) * BigInt(10000 + bonus) / (BigInt(reference) * 10000n * 10000n)) - defense - guard + (element === 'physical' ? actor.attributes?.effective.physicalDamageFlat ?? 0 : 0));
    victim.hp = Math.max(0, victim.hp - amount + absorbShields(victim, amount));
    addLog(b, `${actor.name} → ${victim.name}: ${amount} урона (${element}${critical ? ', критический' : ''})`);
    return;
  }
  const amount = Math.max(1, Math.floor(power * multiplier / 10000 + actor.stats.attack - victim.stats.defense - guard));
  victim.hp = Math.max(0, victim.hp - amount + absorbShields(victim, amount)); addLog(b, `${actor.name} → ${victim.name}: ${amount} урона`);
}

/** New composed effects supply already resolved raw damage from the pre-cast snapshot. */
export function applyResolvedDamage(battle: Battle, actor: Fighter, target: Fighter, raw: number, element: Element, canCrit = true,
  precise?: Rational, context?: DamageContext): number {
  if (battle.content.balance.formulas) return resolveDamage(battle, actor, target, precise ?? rational(raw), element, canCrit, context);
  if (raw <= 0) { addLog(battle, `${actor.name} → ${target.name}: 0 урона (${element})`); return 0; }
  const critical = !context?.periodic && canCrit && battleRandomBps(battle) < (criticalChanceBps(actor, element));
  const bonus = critical ? actor.attributes?.effective.criticalBonusBps ?? 0 : 0;
  const defense = target.attributes?.effective[element === 'physical' ? 'physicalResistance' : `${element}Resistance`] ?? target.stats.defense;
  const amount = Math.max(1, Number(BigInt(raw) * BigInt(10000 + bonus) / 10000n) - defense - (target.guardDefense ?? 0) + (element === 'physical' && !context?.periodic ? actor.attributes?.effective.physicalDamageFlat ?? 0 : 0));
  const actual = Math.min(target.hp, amount - absorbShields(target, amount));
  target.hp -= actual;
  addLog(battle, `${actor.name} → ${target.name}: ${actual} урона (${element}${critical ? ', критический' : ''})`);
  return actual;
}
