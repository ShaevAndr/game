import { add, boundedFloor, multiply, rational, type Rational } from './rational';
import type { AttributeCalculation, AttributeCalculationInput, StatDefinition, StatModifier } from './types';

const LIMIT = 1_000_000;
function integer(value: number, name: string, max = LIMIT) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > max) throw new Error(`Недопустимое значение ${name}`);
}

/** Returns a stable topological order; invalid content fails before calculation. */
export function validateStatDefinitions(definitions: StatDefinition[]): StatDefinition[] {
  if (!definitions.length || definitions.length > 64) throw new Error('Реестр должен содержать от 1 до 64 характеристик');
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  if (byId.size !== definitions.length) throw new Error('ID характеристик должны быть уникальными');
  for (const definition of definitions) {
    if (!/^[a-z][a-zA-Z0-9-]{0,63}$/.test(definition.id)) throw new Error('Неверный ID характеристики');
    integer(definition.min, 'min'); integer(definition.max, 'max');
    if (definition.min > definition.max || definition.rounding !== 'floor') throw new Error(`Неверные границы ${definition.id}`);
    if (definition.kind === 'primary') {
      integer(definition.defaultValue, 'defaultValue'); integer(definition.growthPerLevel, 'growthPerLevel');
      if (definition.defaultValue < definition.min || definition.defaultValue > definition.max || definition.growthPerLevel < 0) throw new Error(`Неверная база ${definition.id}`);
    } else {
      integer(definition.formula.constant ?? 0, 'constant');
      if (definition.formula.terms.length > 32) throw new Error('В формуле допускается до 32 ссылок');
      for (const term of definition.formula.terms) {
        if (!byId.has(term.statId)) throw new Error(`Неизвестная характеристика ${term.statId}`);
        integer(term.coefficientBps, 'coefficientBps', 10_000_000);
      }
    }
  }
  const ordered: StatDefinition[] = [], visited = new Set<string>(), visiting = new Set<string>();
  const depths = new Map<string, number>();
  const visit = (id: string): number => {
    if (visiting.has(id)) throw new Error('В формулах характеристик обнаружен цикл');
    if (visited.has(id)) return depths.get(id)!;
    const definition = byId.get(id)!;
    visiting.add(id);
    const depth = definition.kind === 'primary' ? 1 : 1 + Math.max(0, ...definition.formula.terms.map(term => visit(term.statId)));
    if (depth > 16) throw new Error('Глубина формул превышает 16');
    visiting.delete(id); visited.add(id); depths.set(id, depth); ordered.push(definition);
    return depth;
  };
  for (const definition of definitions) visit(definition.id);
  return ordered;
}

function validateModifiers(modifiers: StatModifier[], definitions: StatDefinition[]) {
  const ids = new Set<string>(), statIds = new Set(definitions.map(definition => definition.id));
  if (modifiers.length > 512) throw new Error('Слишком много модификаторов');
  for (const modifier of modifiers) {
    if (!modifier.id || ids.has(modifier.id)) throw new Error('ID модификаторов должны быть уникальными');
    ids.add(modifier.id);
    if (!statIds.has(modifier.statId)) throw new Error(`Неизвестная характеристика ${modifier.statId}`);
    if (!['add_flat', 'add_percent', 'multiply', 'set'].includes(modifier.operation)) throw new Error('Неизвестная операция модификатора');
    integer(modifier.value, 'modifier.value', modifier.operation === 'add_flat' || modifier.operation === 'set' ? LIMIT : 10_000_000);
    integer(modifier.priority ?? 0, 'priority'); integer(modifier.appliedSequence ?? 0, 'appliedSequence', Number.MAX_SAFE_INTEGER);
    if (modifier.operation === 'multiply' && modifier.value < 0) throw new Error('Множитель не может быть отрицательным');
    if (!modifier.sourceId) throw new Error('У модификатора должен быть источник');
  }
}

function applyModifiers(base: Rational, modifiers: StatModifier[], extraFlat = rational(0)): Rational {
  let value = add(base, extraFlat), percent = 10000;
  const ordered = [...modifiers].sort((left, right) => left.id.localeCompare(right.id));
  for (const modifier of ordered) {
    if (modifier.operation === 'add_flat') value = add(value, rational(modifier.value));
    if (modifier.operation === 'add_percent') percent += modifier.value;
  }
  value = multiply(value, rational(Math.max(0, percent), 10000));
  for (const modifier of ordered) if (modifier.operation === 'multiply') value = multiply(value, rational(modifier.value, 10000));
  const overrides = ordered.filter(modifier => modifier.operation === 'set').sort((left, right) =>
    (left.priority ?? 0) - (right.priority ?? 0) || (left.appliedSequence ?? 0) - (right.appliedSequence ?? 0) || left.id.localeCompare(right.id));
  return overrides.length ? rational(overrides[overrides.length - 1].value) : value;
}

function evaluateFormula(definition: StatDefinition, values: Record<string, number>): Rational {
  if (definition.kind !== 'derived') throw new Error('Ожидалась производная характеристика');
  return definition.formula.terms.reduce((total, term) => add(total, multiply(rational(values[term.statId]), rational(term.coefficientBps, 10000))), rational(definition.formula.constant ?? 0));
}

export function calculateAttributes(input: AttributeCalculationInput): AttributeCalculation {
  const definitions = validateStatDefinitions(input.definitions);
  const permanent = input.permanentModifiers ?? [], equipment = input.equipmentModifiers ?? [], temporary = input.temporaryModifiers ?? [];
  validateModifiers([...permanent, ...equipment, ...temporary], definitions);
  for (const [id, value] of Object.entries(input.baseAttributes)) {
    const definition = definitions.find(definition => definition.id === id);
    if (!definition || definition.kind !== 'primary') throw new Error(`Неизвестная первичная характеристика ${id}`);
    integer(value, id);
    if (value < definition.min || value > definition.max) throw new Error(`База ${id} вне границ`);
  }
  const scaling = input.equipmentScaling ?? [];
  if (scaling.length > 128) throw new Error('Слишком много масштабируемых бонусов');
  const sourceIds = new Set([...permanent, ...equipment, ...temporary].map(modifier => modifier.id));
  for (const bonus of scaling) {
    if (!bonus.id || sourceIds.has(bonus.id)) throw new Error('ID модификаторов должны быть уникальными');
    sourceIds.add(bonus.id);
    if (definitions.find(definition => definition.id === bonus.statId)?.kind !== 'derived' || !definitions.some(definition => definition.id === bonus.scalingStatId)) throw new Error('Масштабирование требует известные характеристики и производную цель');
    integer(bonus.baseValue, 'baseValue'); integer(bonus.coefficientBps, 'coefficientBps', 10_000_000);
    if (bonus.baseValue < 0 || bonus.coefficientBps < 0 || !bonus.sourceId) throw new Error('Неверный масштабируемый бонус');
  }
  const forStat = (modifiers: StatModifier[], id: string) => modifiers.filter(modifier => modifier.statId === id);
  const layer = (withEquipment: boolean, withTemporary: boolean): Record<string, number> => {
    const values: Record<string, number> = {};
    const intrinsic: Record<string, number> = {};
    for (const definition of definitions.filter(definition => definition.kind === 'primary')) {
      if (definition.kind !== 'primary') continue;
      let value = applyModifiers(rational(Object.hasOwn(input.baseAttributes, definition.id) ? input.baseAttributes[definition.id] : definition.defaultValue), forStat(permanent, definition.id));
      if (withEquipment) value = applyModifiers(value, forStat(equipment, definition.id));
      if (withTemporary) value = applyModifiers(value, forStat(temporary, definition.id));
      values[definition.id] = intrinsic[definition.id] = boundedFloor(value, definition.min, definition.max);
    }
    for (const definition of definitions.filter(definition => definition.kind === 'derived')) {
      intrinsic[definition.id] = boundedFloor(applyModifiers(evaluateFormula(definition, intrinsic), forStat(permanent, definition.id)), definition.min, definition.max);
    }
    for (const definition of definitions.filter(definition => definition.kind === 'derived')) {
      let value = applyModifiers(evaluateFormula(definition, values), forStat(permanent, definition.id));
      if (withEquipment) {
        const scaled = scaling.filter(bonus => bonus.statId === definition.id).reduce((sum, bonus) => add(sum,
          multiply(rational(bonus.baseValue), add(rational(1), multiply(rational(intrinsic[bonus.scalingStatId]), rational(bonus.coefficientBps, 10000))))), rational(0));
        value = applyModifiers(value, forStat(equipment, definition.id), scaled);
      }
      if (withTemporary) value = applyModifiers(value, forStat(temporary, definition.id));
      values[definition.id] = boundedFloor(value, definition.min, definition.max);
    }
    return values;
  };
  const base = layer(false, false), equipped = layer(true, false), effective = layer(true, true);
  const breakdown = Object.fromEntries(definitions.map(definition => [definition.id, { base: base[definition.id], equipped: equipped[definition.id], effective: effective[definition.id] }]));
  return { base, equipped, effective, breakdown };
}

/** Filling is idempotent: existing primary values and unknown saved keys are preserved. */
export function fillBaseAttributes(saved: Record<string, number>, level: number, definitions: StatDefinition[]): Record<string, number> {
  integer(level, 'level', 1000);
  if (level < 1) throw new Error('Уровень должен быть положительным');
  validateStatDefinitions(definitions);
  const result = { ...saved };
  for (const definition of definitions) if (definition.kind === 'primary' && !Object.hasOwn(result, definition.id)) {
    result[definition.id] = Math.min(definition.max, definition.defaultValue + (level - 1) * definition.growthPerLevel);
  }
  return result;
}

/** Changing max HP never heals or revives; current HP is a separate resource. */
export function clampCurrentHp(current: number, maxHp: number): number {
  integer(current, 'currentHp'); integer(maxHp, 'maxHp');
  if (current < 0 || maxHp < 1) throw new Error('Неверное здоровье');
  return Math.min(current, maxHp);
}
