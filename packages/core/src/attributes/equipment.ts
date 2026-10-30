import type { ScaledEquipmentBonus, StatModifier } from './types';
import { DEFAULT_WEAPON_SCALING_BPS } from './defaults';

export function legacyEquipmentAttributes(bonuses: Record<string, number | undefined>, sourceId: string) {
  const modifiers: StatModifier[] = [], scaling: ScaledEquipmentBonus[] = [];
  const mapping: Record<string, string> = { maxHp: 'maxHp', defense: 'physicalResistance' };
  for (const [legacyId, value] of Object.entries(bonuses)) {
    if (!value) continue;
    if (legacyId === 'attack') scaling.push({ id: `${sourceId}:attack`, sourceId, statId: 'physicalPower', baseValue: value, scalingStatId: 'physicalPower', coefficientBps: DEFAULT_WEAPON_SCALING_BPS });
    else if (mapping[legacyId]) modifiers.push({ id: `${sourceId}:${legacyId}`, sourceId, statId: mapping[legacyId], operation: 'add_flat', value });
  }
  return { modifiers, scaling };
}
