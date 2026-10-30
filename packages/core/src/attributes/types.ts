export type StatId = string;
export type StatUnit = 'points' | 'hp' | 'basis_points' | 'points_per_cell';
export interface StatFormula {
  constant?: number;
  terms: { statId: StatId; coefficientBps: number }[];
}
interface StatDisplay {
  id: StatId; name: string; description: string; displayOrder: number; unit: StatUnit;
  min: number; max: number; group: string; visible: boolean; rounding: 'floor';
}
export type StatDefinition = StatDisplay & (
  | { kind: 'primary'; defaultValue: number; growthPerLevel: number }
  | { kind: 'derived'; formula: StatFormula }
);
export interface StatModifier {
  id: string; statId: StatId; operation: 'add_flat' | 'add_percent' | 'multiply' | 'set';
  value: number; sourceId: string; priority?: number; appliedSequence?: number;
}
/** An item contributes W × (1 + intrinsic[scalingStatId] × coefficientBps / 10000). */
export interface ScaledEquipmentBonus {
  id: string; statId: StatId; baseValue: number; scalingStatId: StatId; coefficientBps: number; sourceId: string;
}
export interface AttributeCalculationInput {
  definitions: StatDefinition[]; baseAttributes: Record<StatId, number>;
  permanentModifiers?: StatModifier[];
  equipmentModifiers?: StatModifier[];
  equipmentScaling?: ScaledEquipmentBonus[];
  temporaryModifiers?: StatModifier[];
}
export interface AttributeCalculation {
  base: Record<StatId, number>;
  equipped: Record<StatId, number>;
  effective: Record<StatId, number>;
  breakdown: Record<StatId, { base: number; equipped: number; effective: number }>;
}
