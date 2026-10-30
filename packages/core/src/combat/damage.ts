import type { Battle, Element, Fighter } from '../types';
import { addLog } from './log';

function criticalRoll(battle: Battle): number {
  if (battle.attributeRngState === undefined) {
    let seed = 2166136261;
    for (const character of battle.id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    battle.attributeRngState = seed >>> 0;
  }
  battle.attributeRngState = (Math.imul(battle.attributeRngState, 1664525) + 1013904223) >>> 0;
  return battle.attributeRngState / 4294967296 * 10000;
}

export function damage(b: Battle, actor: Fighter, victim: Fighter, power: number, element: Element = 'physical') {
  const guard = b.combatVersion === 2 ? victim.guardDefense ?? 0 : 0;
  if (b.content.statDefinitions) {
    const attack = actor.attributes?.effective[element === 'physical' ? 'physicalPower' : 'magicPower'] ?? actor.stats.attack;
    const defense = victim.attributes?.effective[element === 'physical' ? 'physicalResistance' : `${element}Resistance`] ?? victim.stats.defense;
    const critical = criticalRoll(b) < (actor.attributes?.effective.criticalChanceBps ?? 0);
    const bonus = critical ? actor.attributes!.effective.criticalBonusBps : 0;
    // Existing skill power is a coefficient relative to the reference power 8, never free damage.
    const reference = b.content.balance.attributes?.skillReferencePower ?? 8;
    const amount = Math.max(1, Number(BigInt(attack) * BigInt(reference + power) * BigInt(10000 + bonus) / (BigInt(reference) * 10000n)) - defense - guard);
    victim.hp = Math.max(0, victim.hp - amount);
    addLog(b, `${actor.name} → ${victim.name}: ${amount} урона (${element}${critical ? ', критический' : ''})`);
    return;
  }
  const amount = Math.max(1, Math.floor(power + actor.stats.attack - victim.stats.defense - guard));
  victim.hp = Math.max(0, victim.hp - amount); addLog(b, `${actor.name} → ${victim.name}: ${amount} урона`);
}

/** New composed effects supply already resolved raw damage from the pre-cast snapshot. */
export function applyResolvedDamage(battle: Battle, actor: Fighter, target: Fighter, raw: number, element: Element, canCrit = true): number {
  if (raw <= 0) { addLog(battle, `${actor.name} → ${target.name}: 0 урона (${element})`); return 0; }
  const critical = canCrit && criticalRoll(battle) < (actor.attributes?.effective.criticalChanceBps ?? 0);
  const bonus = critical ? actor.attributes?.effective.criticalBonusBps ?? 0 : 0;
  const defense = target.attributes?.effective[element === 'physical' ? 'physicalResistance' : `${element}Resistance`] ?? target.stats.defense;
  const amount = Math.max(1, Number(BigInt(raw) * BigInt(10000 + bonus) / 10000n) - defense - (target.guardDefense ?? 0));
  const actual = Math.min(target.hp, amount);
  target.hp = Math.max(0, target.hp - amount);
  addLog(battle, `${actor.name} → ${target.name}: ${actual} урона (${element}${critical ? ', критический' : ''})`);
  return actual;
}
