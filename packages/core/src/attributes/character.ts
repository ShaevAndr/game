import type { Character, Content, Stats } from '../types';
import { calculateAttributes, fillBaseAttributes } from './calculation';
import { ATTRIBUTE_POINTS_PER_LEVEL } from './defaults';
import { legacyEquipmentAttributes } from './equipment';

export function compatibilityStats(values: Record<string, number>): Stats {
  return { maxHp: values.maxHp, attack: values.physicalPower, defense: values.physicalResistance, maxEnergy: 30 };
}

/** Old records are upgraded without losing level, XP, skills, equipment or spent attribute points. */
export function projectCharacterAttributes(character: Character, content: Content): Character {
  if (!content.statDefinitions) return character;
  const baseAttributes = fillBaseAttributes(character.baseAttributes ?? {}, character.level, content.statDefinitions);
  const legacy = legacyEquipmentAttributes(character.equipmentBonuses ?? {}, 'legacy-equipment');
  const equipmentModifiers = character.equipmentModifiers ?? legacy.modifiers;
  const equipmentScaling = character.equipmentScaling ?? legacy.scaling;
  const attributes = calculateAttributes({ definitions: content.statDefinitions, baseAttributes, equipmentModifiers, equipmentScaling });
  const stats = compatibilityStats(attributes.base), equipped = compatibilityStats(attributes.equipped);
  const equipmentBonuses = Object.fromEntries(Object.keys(stats).map(key => [key, equipped[key as keyof Stats] - stats[key as keyof Stats]]));
  return { ...character, attributeVersion: 1, baseAttributes, attributePoints: character.attributePoints ?? (character.level - 1) * ATTRIBUTE_POINTS_PER_LEVEL, attributeRevision: character.attributeRevision ?? 0,
    equipmentModifiers, equipmentScaling, attributes, stats, equipmentBonuses };
}

export function allocateAttributes(character: Character, allocations: Record<string, number>, content: Content): Character {
  if (!content.statDefinitions || character.attributeVersion !== 1) throw new Error('Новая модель характеристик недоступна');
  let total = 0;
  const baseAttributes = { ...character.baseAttributes };
  for (const [id, quantity] of Object.entries(allocations)) {
    const definition = content.statDefinitions.find(definition => definition.id === id);
    if (!definition || definition.kind !== 'primary') throw new Error(`Неизвестная первичная характеристика ${id}`);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Распределяйте положительное целое число очков');
    const next = (baseAttributes[id] ?? definition.defaultValue) + quantity;
    if (next > definition.max) throw new Error(`Достигнут предел характеристики «${definition.name}»`);
    total += quantity; baseAttributes[id] = next;
  }
  if (!total || total > (character.attributePoints ?? 0)) throw new Error('Недостаточно очков характеристик');
  return projectCharacterAttributes({ ...character, baseAttributes, attributePoints: character.attributePoints! - total, attributeRevision: (character.attributeRevision ?? 0) + 1 }, content);
}
