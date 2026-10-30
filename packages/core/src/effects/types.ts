import type { Element } from '../types';
import type { StatModifier, StatUnit } from '../attributes/types';

export type EffectUnit = StatUnit | 'turns';
export interface EffectExpression {
  unit: EffectUnit; constant?: number;
  terms?: { scope: 'caster' | 'target'; statId: string; weightBps: number; weightPerRankBps?: number }[];
  min?: number; max?: number;
}
export type SkillTargeting =
  | { kind: 'self' | 'enemy_single' | 'enemies_all' }
  | { kind: 'ally_single' | 'allies_all'; includeSelf?: boolean };
interface EffectBase { id: string; name?: string; recipient: 'selected' | 'caster' }
export interface StatModifierEffect extends EffectBase {
  modifierDefinitionId?: string;
  kind: 'stat_modifier'; polarity: 'buff' | 'debuff' | 'neutral'; statId: string;
  operation: StatModifier['operation']; magnitude: EffectExpression;
  durationTurns: number | EffectExpression; tags?: string[]; dispellable?: boolean;
  stackKey?: string; stacking?: 'refresh' | 'replace_if_stronger' | 'stack' | 'independent'; maxStacks?: number; priority?: number;
}
export interface DispelEffect extends EffectBase {
  kind: 'dispel'; polarityToRemove: 'buff' | 'debuff'; maxCount: number; tags?: string[];
}
export interface DamageEffect extends EffectBase { kind: 'damage'; magnitude: EffectExpression; damageType: Element; canCrit?: boolean }
export interface HealEffect extends EffectBase { kind: 'heal'; magnitude: EffectExpression }
export type SkillEffect = StatModifierEffect | DispelEffect | DamageEffect | HealEffect;
export interface ActiveEffect {
  instanceId: string; definitionId: string; name: string; sourceFighterId: string; sourceName?: string; sourceSkillId: string; sourceRank: number;
  targetFighterId: string; polarity: StatModifierEffect['polarity']; tags: string[]; dispellable: boolean;
  statId: string; operation: StatModifier['operation']; magnitude: number; unit: EffectUnit; priority: number;
  remainingTurns: number; eligibleFromTurn: number; appliedSequence: number;
  stackKey: string; stacking: NonNullable<StatModifierEffect['stacking']>; stacks: number; maxStacks: number;
}
export interface EffectPreview {
  effectId: string; name: string; kind: SkillEffect['kind']; targetId: string;
  magnitude?: number; unit?: EffectUnit; durationTurns?: number; statId?: string;
  operation?: StatModifier['operation']; polarity?: StatModifierEffect['polarity'];
}
