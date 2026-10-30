import { z } from 'zod';
import type { Content, Item } from './types';
import type { ItemInstance } from './inventory';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const itemRankSchema = z.object({
  id, name: z.string().min(1).max(80), order: z.number().int().min(1).max(7),
  multiplierBps: z.number().int().min(10000).max(100000), affixCount: z.number().int().min(0).max(6),
  frameColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();
export type ItemRank = z.infer<typeof itemRankSchema>;
export const professionSchema = z.object({ id, name: z.string().min(1).max(80), groupIds: z.array(id).min(1), xpPerCraft: z.number().int().min(1).max(1000) }).strict();
export type CraftingProfession = z.infer<typeof professionSchema>;
export const rankProfileSchema = z.object({ id, levels: z.array(z.object({ level: z.number().int().min(1).max(100), chances: z.array(z.object({ rankId: id, chanceBps: z.number().int().min(0).max(10000) }).strict()).min(1).max(7) }).strict()).length(100) }).strict();
export type RankProfile = z.infer<typeof rankProfileSchema>;
/** Parameterized modifier definition shared by skill content and rolled item affixes. */
export const modifierDefinitionSchema = z.object({
  id, version: z.number().int().min(1), name: z.string().min(1).max(80), statId: z.string().min(1).max(64),
  operation: z.enum(['add_flat', 'add_percent', 'multiply', 'set']),
  allowSkill: z.boolean(), allowWeapon: z.boolean(), allowArmor: z.boolean(),
  minValue: z.number().int().min(0).max(10000), maxValue: z.number().int().min(0).max(10000),
}).strict().refine(value => value.minValue <= value.maxValue, 'Неверный диапазон величин допа');
export type ModifierDefinition = z.infer<typeof modifierDefinitionSchema>;
export interface RolledAffix { effectId: string; effectVersion: number; name: string; statId: string; operation: ModifierDefinition['operation']; value: number }
/** Snapshots keep existing items independent of subsequent catalog edits. */
export interface ItemQuality { rank: ItemRank; affixes: RolledAffix[] }
export const defaultItemRanks: ItemRank[] = [
  ['common', 'Обычный', 10000, '#9ca3af'], ['fine', 'Добротный', 11500, '#65c46f'],
  ['superior', 'Превосходный', 13500, '#59c9e8'], ['rare', 'Редкий', 16000, '#608fff'],
  ['epic', 'Эпический', 20000, '#ba80ed'], ['legendary', 'Легендарный', 26000, '#f5a34c'],
  ['mythic', 'Мифический', 35000, '#f16a76'],
].map(([id, name, multiplierBps, frameColor], index) => ({ id: String(id), name: String(name), order: index + 1, multiplierBps: Number(multiplierBps), affixCount: index, frameColor: String(frameColor) }));
export const defaultProfessions: CraftingProfession[] = [
  { id: 'blacksmith', name: 'Кузнец', groupIds: ['weapons'], xpPerCraft: 10 },
  { id: 'leatherworker', name: 'Кожевник', groupIds: ['equipment'], xpPerCraft: 10 },
  { id: 'alchemist', name: 'Алхимик', groupIds: ['potions'], xpPerCraft: 10 },
];
export const defaultModifierDefinitions: ModifierDefinition[] = [
  ['physical-power', 'Физическая мощь', 'physicalPower', 1, 5],
  ['physical-damage', 'Прибавка к физическому урону', 'physicalDamageFlat', 1, 7],
  ['magic-power', 'Магическая мощь', 'magicPower', 1, 5],
  ['health', 'Максимум здоровья', 'maxHp', 5, 25],
  ['physical-armor', 'Физическая защита', 'physicalResistance', 1, 4],
  ['healing-power', 'Сила лечения', 'healingPower', 1, 5],
  ['strength', 'Сила', 'strength', 1, 3], ['vitality', 'Выносливость', 'vitality', 1, 3],
].map(([id, name, statId, minValue, maxValue]) => ({ id: String(id), version: 1, name: String(name), statId: String(statId), operation: 'add_flat', allowSkill: true, allowWeapon: true, allowArmor: true, minValue: Number(minValue), maxValue: Number(maxValue) }));
/** Repeated promotion trials. Higher profession levels increase every upper-tail probability. */
export const defaultRankProfiles: RankProfile[] = [{ id: 'standard', levels: Array.from({ length: 100 }, (_, index) => {
  const promotion = 0.08 + index * 0.006;
  const tails = defaultItemRanks.map((_, rank) => rank === 0 ? 10000 : Math.floor(10000 * promotion ** rank));
  return { level: index + 1, chances: defaultItemRanks.map((rank, i) => ({ rankId: rank.id, chanceBps: tails[i] - (tails[i + 1] ?? 0) })) };
}) }];
export function professionProgress(totalXp = 0) {
  if (!Number.isSafeInteger(totalXp) || totalXp < 0 || totalXp > 1_000_000_000) throw new Error('Некорректный опыт профессии');
  let level = 1, xp = totalXp;
  while (level < 100 && xp >= 100 + 20 * (level - 1)) { xp -= 100 + 20 * (level - 1); level++; }
  return { level, xp: level === 100 ? 0 : xp, xpToNext: level === 100 ? 0 : 100 + 20 * (level - 1), totalXp };
}
export function rollBelow(roll: (max: number) => number, max: number) {
  const value = roll(max);
  if (!Number.isInteger(value) || value < 0 || value >= max) throw new Error('Некорректный результат генератора случайности');
  return value;
}
export function professionForItem(item: Item, content: Pick<Content, 'professions'>) {
  return content.professions?.find(profession => profession.groupIds.includes(item.groupId));
}
export function qualityForItem(item: Item, policy: { mode: 'fixed'; rankId: string } | { mode: 'profession'; profileId: string }, level: number, content: Pick<Content, 'itemRanks' | 'rankProfiles' | 'modifierDefinitions'>, roll: (max: number) => number): ItemQuality {
  const ranks = content.itemRanks ?? defaultItemRanks;
  let rankId: string;
  if (policy.mode === 'fixed') rankId = policy.rankId;
  else {
    const distribution = content.rankProfiles?.find(profile => profile.id === policy.profileId)?.levels.find(entry => entry.level === level)?.chances;
    if (!distribution || distribution.reduce((sum, entry) => sum + entry.chanceBps, 0) !== 10000) throw new Error('Распределение рангов не найдено');
    let remaining = rollBelow(roll, 10000);
    rankId = distribution[distribution.length - 1].rankId;
    for (const entry of distribution) { if (remaining < entry.chanceBps) { rankId = entry.rankId; break; } remaining -= entry.chanceBps; }
  }
  const rank = ranks.find(entry => entry.id === rankId);
  if (!rank) throw new Error('Неизвестный ранг');
  const pool = (content.modifierDefinitions ?? []).filter(effect => item.groupId === 'weapons' ? effect.allowWeapon : item.groupId === 'equipment' && effect.allowArmor);
  if (pool.length < rank.affixCount) throw new Error('Недостаточно совместимых допов для ранга');
  const affixes: RolledAffix[] = [];
  for (let i = 0; i < rank.affixCount; i++) {
    const effect = pool.splice(rollBelow(roll, pool.length), 1)[0];
    affixes.push({ effectId: effect.id, effectVersion: effect.version, name: effect.name, statId: effect.statId, operation: effect.operation, value: effect.minValue + rollBelow(roll, effect.maxValue - effect.minValue + 1) });
  }
  return structuredClone({ rank, affixes });
}
export function rankedItemDefinition(item: Item, instance: Pick<ItemInstance, 'quality'>): Item {
  const multiplier = instance.quality?.rank.multiplierBps ?? 10000;
  return { ...item,
    bonuses: item.bonuses && Object.fromEntries(Object.entries(item.bonuses).map(([key, value]) => [key, Math.floor(value * multiplier / 10000)])),
    statModifiers: item.statModifiers?.map(modifier => ({ ...modifier, value: modifier.operation === 'add_flat' ? Math.floor(modifier.value * multiplier / 10000) : modifier.value })),
    scaledBonuses: item.scaledBonuses?.map(bonus => ({ ...bonus, baseValue: Math.floor(bonus.baseValue * multiplier / 10000) })),
  };
}

export function validateCraftingProgression(content: Pick<Content, 'itemRanks' | 'rankProfiles' | 'professions' | 'modifierDefinitions' | 'recipes' | 'items' | 'statDefinitions'>) {
  const ranks = [...(content.itemRanks ?? [])].sort((a, b) => a.order - b.order);
  const unique = (values: { id: string }[], label: string) => { if (new Set(values.map(value => value.id)).size !== values.length) throw new Error(`Дубликат ${label}`); };
  unique(ranks, 'ранга'); unique(content.professions ?? [], 'профессии'); unique(content.rankProfiles ?? [], 'профиля'); unique(content.modifierDefinitions ?? [], 'эффекта');
  if (!ranks.length && !content.professions?.length && !content.modifierDefinitions?.length && !content.rankProfiles?.length) return;
  if (!ranks.length || ranks.some((rank, index) => rank.order !== index + 1 || rank.affixCount !== index || (index > 0 && rank.multiplierBps <= ranks[index - 1].multiplierBps))) throw new Error('Неверный порядок рангов');
  if (new Set(ranks.map(rank => rank.frameColor.toLowerCase())).size !== ranks.length) throw new Error('Цвета рангов должны различаться');
  for (const effect of content.modifierDefinitions ?? []) {
    if (!content.statDefinitions?.some(stat => stat.id === effect.statId)) throw new Error(`Неизвестная характеристика допа ${effect.statId}`);
  }
  for (const profile of content.rankProfiles ?? []) {
    let previous: number[] | undefined;
    let improved = false;
    for (let level = 1; level <= 100; level++) {
      const entries = profile.levels.filter(entry => entry.level === level);
      const chances = entries[0]?.chances ?? [];
      if (entries.length !== 1 || chances.length !== ranks.length || new Set(chances.map(entry => entry.rankId)).size !== ranks.length || chances.some(entry => !ranks.some(rank => rank.id === entry.rankId)) || chances.reduce((sum, entry) => sum + entry.chanceBps, 0) !== 10000) throw new Error('Неверное распределение рангов');
      const tails = ranks.map(rank => chances.filter(entry => ranks.find(candidate => candidate.id === entry.rankId)!.order >= rank.order).reduce((sum, entry) => sum + entry.chanceBps, 0));
      if (previous && tails.some((value, index) => value < previous![index])) throw new Error('Рост профессии снижает шанс высокого ранга');
      if (previous && tails.some((value, index) => value > previous![index])) improved = true;
      previous = tails;
    }
    if (!improved) throw new Error('Профессия должна повышать шанс высокого ранга');
  }
  const groups = new Set<string>();
  for (const profession of content.professions ?? []) for (const group of profession.groupIds) { if (groups.has(group)) throw new Error('Группа привязана к нескольким профессиям'); groups.add(group); }
  for (const recipe of content.recipes ?? []) {
    if (recipe.professionId && !content.professions?.some(profession => profession.id === recipe.professionId)) throw new Error('Неизвестная профессия рецепта');
    for (const output of recipe.outputs) {
      const item = content.items.find(item => item.id === output.itemId);
      if (!item) continue;
      if (!item.equipSlot) { if (output.rankPolicy) throw new Error('Ранг требует экипируемый предмет'); continue; }
      const policy = output.rankPolicy;
      if (!policy) throw new Error('Экипировка требует политику ранга');
      if (!(recipe.professionId || professionForItem(item, content))) throw new Error('Не определена профессия рецепта');
      if (item.statModifiers?.some(modifier => modifier.value < 0 || modifier.operation !== 'add_flat')) throw new Error('Ранговая база поддерживает положительные плоские модификаторы');
      const allowedRanks = policy.mode === 'fixed' ? ranks.filter(rank => rank.id === policy.rankId) : ranks;
      if (policy.mode === 'fixed' && !allowedRanks.length || policy.mode === 'profession' && !content.rankProfiles?.some(profile => profile.id === policy.profileId)) throw new Error('Неизвестная политика ранга');
      const pool = (content.modifierDefinitions ?? []).filter(effect => item.groupId === 'weapons' ? effect.allowWeapon : item.groupId === 'equipment' && effect.allowArmor);
      if (allowedRanks.some(rank => rank.affixCount > pool.length)) throw new Error('Недостаточно совместимых допов');
    }
  }
}
