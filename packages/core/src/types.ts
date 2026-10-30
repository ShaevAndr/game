import { z } from 'zod';
import { elements, tileTypes, MAX_FIELD_SIDE } from './battlefield/types';
import type { BattlefieldConfig, BattlefieldMoveEvent } from './battlefield/types';
import { normalizeBattlefieldOptions } from './battlefield/config';
export { elements, tileTypes } from './battlefield/types';
import { itemDefinitionSchema, itemGroupSchema, defaultItemGroups } from './items';
import type { ItemDefinition, ItemGroup } from './items';
import { blindCraftRulesSchema, craftingRecipeSchema } from './crafting';
import type { BlindCraftRules, CraftingRecipe } from './crafting';

export type Element = typeof elements[number];
export type TileType = typeof tileTypes[number];
export const elementNames: Record<Element, string> = { fire: 'Огонь', water: 'Вода', earth: 'Земля', air: 'Воздух', physical: 'Сила' };
export const tileTypeNames: Record<TileType, string> = { ...elementNames, defense: 'Защита' };
export type Energy = Record<Element, number> & { defense?: number };
export const emptyEnergy = (): Energy => ({ fire: 0, water: 0, earth: 0, air: 0, physical: 0, defense: 0 });
export interface Stats { maxHp: number; attack: number; defense: number; maxEnergy: number }
export type Item = ItemDefinition;
export interface ItemStack { itemId: string; quantity: number }
export interface Character { id: string; name: string; templateId?: string; level: number; experience: number; skillPoints: number; learnedSkillIds: string[]; skillLevels?: Record<string, number>; equipmentBonuses?: Partial<Stats>; stats: Stats; energy: Energy; inventory: ItemStack[]; createdAt: string }
export interface CharacterTemplate { id: string; name: string; description: string; element: Element; skillId: string }
export interface SkillLearning { pointCost: number; level: number; prerequisites: string[]; stats: Partial<Stats>; starter: boolean }
export interface Skill { id: string; name: string; description: string; element: Element; cost: number; power: number; effect: 'damage' | 'heal'; cooldown: number; learning: SkillLearning; progression?: SkillProgression }
export interface SkillProgression { maxLevel: number; pointCost: number; powerPerLevel: number }
export interface Enemy { id: string; name: string; stats: Stats; skillIds: string[] }
export interface Progression { baseExperience: number; experiencePerLevel: number; startingSkillPoints: number; skillPointsPerLevel: number; statGrowth: Stats; victoryExperience: Record<BattleKind, number> }
export interface CombatRules { version: 2; energyCap: 30; energyPerTile: 1; defensePerTile: number }
export interface Balance { combat?: CombatRules; characterStats: Stats; starterItems: ItemStack[]; damagePerTile: number; energyPerTile: number; teamSize: number; dungeonWaves: string[]; progression: Progression; crafting?: { blind: BlindCraftRules } }
export interface Content { itemGroups?: ItemGroup[]; skills: Skill[]; items: Item[]; enemies: Enemy[]; characterTemplates: CharacterTemplate[]; balance: Balance; recipes?: CraftingRecipe[] }
const statsSchema = z.object({ maxHp: z.number().int().positive().max(100000), attack: z.number().int().nonnegative().max(10000), defense: z.number().int().nonnegative().max(10000), maxEnergy: z.number().int().positive().max(10000) });
const contentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const learningSchema = z.object({ pointCost: z.number().int().min(1).max(100), level: z.number().int().min(1).max(1000), prerequisites: z.array(contentId).max(20), stats: statsSchema.partial(), starter: z.boolean() });
export const progressionSchema = z.object({ baseExperience: z.number().int().min(1).max(1000000), experiencePerLevel: z.number().int().min(0).max(1000000), startingSkillPoints: z.number().int().min(0).max(1000), skillPointsPerLevel: z.number().int().min(1).max(100), statGrowth: z.object({ maxHp: z.number().int().min(0).max(1000), attack: z.number().int().min(0).max(1000), defense: z.number().int().min(0).max(1000), maxEnergy: z.number().int().min(0).max(1000) }), victoryExperience: z.object({ duel: z.number().int().positive().max(1000000), bot: z.number().int().positive().max(1000000).default(100), team: z.number().int().positive().max(1000000), dungeon: z.number().int().positive().max(1000000) }) });
export const contentSchema = z.object({
  characterTemplates: z.array(z.object({ id: contentId, name: z.string().min(1).max(80), description: z.string().max(500), element: z.enum(elements), skillId: contentId })).default([]),
  skills: z.array(z.object({ id: contentId, name: z.string().min(1).max(80), description: z.string().max(500), element: z.enum(elements), cost: z.number().int().nonnegative().max(10000), power: z.number().int().nonnegative().max(10000), effect: z.enum(['damage', 'heal']), cooldown: z.number().int().nonnegative().max(100), learning: learningSchema, progression: z.object({ maxLevel: z.number().int().min(1).max(10), pointCost: z.number().int().min(1).max(100), powerPerLevel: z.number().int().min(0).max(10000) }).optional() })).min(1),
  itemGroups: z.array(itemGroupSchema).default(defaultItemGroups),
  items: z.array(itemDefinitionSchema),
  recipes: z.array(craftingRecipeSchema).default([]),
  enemies: z.array(z.object({ id: contentId, name: z.string().min(1).max(80), stats: statsSchema, skillIds: z.array(contentId).min(1) })).min(1),
  balance: z.object({ characterStats: statsSchema, starterItems: z.array(z.object({ itemId: contentId, quantity: z.number().int().nonnegative().max(1000) })), damagePerTile: z.number().int().positive().max(100), energyPerTile: z.number().int().positive().max(100), teamSize: z.number().int().min(1).max(10), dungeonWaves: z.array(contentId).min(1).max(100), progression: progressionSchema, crafting: z.object({ blind: blindCraftRulesSchema }).optional(), combat: z.object({ version: z.literal(2), energyCap: z.literal(30), energyPerTile: z.literal(1), defensePerTile: z.number().int().min(1).max(100) }).optional() }),
}).superRefine((content, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const starters = content.skills.filter(skill => skill.learning.starter);
  if (starters.length !== 1 || starters[0]?.element !== 'physical') fail('Должен быть ровно один стартовый физический навык');
  const modern = content.balance.combat?.version === 2;
  const basic = starters.find(s => s.cooldown === 0 && s.effect === 'damage' && (modern ? s.cost > 0 && s.cost <= 3 : s.cost === 0));
  if (!basic) fail('Нужен доступный стартовый атакующий навык без перезарядки');
  if (modern && content.skills.some(skill => skill.cost < 1 || skill.cost > 30)) fail('Стоимость навыка должна быть от 1 до 30 энергии');
  const groups = new Set(content.itemGroups.map(group => group.id));
  if (groups.size !== content.itemGroups.length) fail('ID групп предметов должны быть уникальными');
  if (new Set(content.items.map(item => item.id)).size !== content.items.length) fail('ID предметов должны быть уникальными');
  for (const item of content.items) {
    if (!groups.has(item.groupId)) fail(`Неизвестная группа предмета ${item.id}`);
    if (item.grantedSkillId && !content.skills.some(skill => skill.id === item.grantedSkillId)) fail(`Неизвестный навык свитка ${item.id}`);
  }
  const recipeIds = new Set(content.recipes.map(recipe => recipe.id));
  if (recipeIds.size !== content.recipes.length) fail('ID рецептов должны быть уникальными');
  for (const recipe of content.recipes) {
    for (const ingredient of [...recipe.inputs, ...recipe.outputs]) {
      if (!content.items.some(item => item.id === ingredient.itemId)) fail(`Неизвестный предмет рецепта ${recipe.id}: ${ingredient.itemId}`);
    }
  }
  const skills = new Map(content.skills.map(s => [s.id, s]));
  if (skills.size !== content.skills.length) fail('ID навыков должны быть уникальными');
  if (new Set(content.characterTemplates.map(t => t.id)).size !== content.characterTemplates.length) fail('ID типов персонажей должны быть уникальными');
  for (const template of content.characterTemplates) {
    const skill = skills.get(template.skillId);
    if (!skill || skill.element !== template.element || skill.learning.starter || skill.learning.level !== 1 || skill.learning.prerequisites.length) { fail(`Недоступный начальный навык персонажа ${template.id}`); continue; }
    if (skill.learning.pointCost > content.balance.progression.startingSkillPoints || Object.entries(skill.learning.stats).some(([key, value]) => content.balance.characterStats[key as keyof Stats] < value!)) fail(`Не выполнены требования начального навыка персонажа ${template.id}`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { fail('В дереве навыков обнаружен цикл'); return; }
    if (visited.has(id)) return;
    const skill = skills.get(id); if (!skill) { fail(`Неизвестный обязательный навык ${id}`); return; }
    if (skill.learning.starter && (skill.learning.level !== 1 || skill.learning.prerequisites.length || Object.keys(skill.learning.stats).length)) fail(`Стартовый навык ${id} не должен иметь требований`);
    visiting.add(id); for (const parent of skill.learning.prerequisites) visit(parent); visiting.delete(id); visited.add(id);
  };
  for (const skill of content.skills) visit(skill.id);
  for (const e of content.enemies) {
    if (!e.skillIds.some(id => content.skills.some(s => s.id === id && s.cooldown === 0 && s.effect === 'damage' && (modern ? s.cost > 0 && s.cost <= 3 : s.cost === 0)))) fail(`Противнику ${e.id} нужен доступный атакующий навык`);
    if (e.skillIds.some(id => !content.skills.some(s => s.id === id))) fail(`Неизвестный навык противника ${e.id}`);
  }
  for (const id of content.balance.dungeonWaves) if (!content.enemies.some(e => e.id === id)) fail(`Неизвестный противник ${id}`);
  for (const item of content.balance.starterItems) if (!content.items.some(i => i.id === item.itemId)) fail(`Неизвестный предмет ${item.itemId}`);
});
export const rules = ['before', 'before-after', 'on-match'] as const;
export type Rule = typeof rules[number];
export type BattleKind = 'duel' | 'bot' | 'team' | 'dungeon';
export interface Fighter { id: string; characterId?: string; name: string; team: number; npc: boolean; stats: Stats; hp: number; energy: Energy; skillEnergy?: number; inventory: ItemStack[]; cooldowns: Record<string, number>; skillIds: string[]; skillLevels?: Record<string, number>; guardDefense?: number }
export type Board = TileType[][];
export interface SkillChoice { skillId: string; enabled: boolean; reason?: string }
export interface Battle {
  id: string; name: string; kind: BattleKind; rule: Rule; status: 'waiting' | 'active' | 'finished';
  combatVersion?: 2; skillChoices?: SkillChoice[]; matchedElements?: Element[];
  version: number; board: Board; battlefield?: BattlefieldConfig; boardMoves?: BattlefieldMoveEvent[]; fighters: Fighter[]; activeId: string | null; turn: number;
  phase: 'before' | 'after' | 'choose'; usedSkill: boolean; pendingMatch: number;
  wave: number; totalWaves: number; winner: number | null; log: string[]; content: Content; createdAt: string;
  rewards?: { characterId: string; experience: number; levelsGained: number }[];
  playback?: BattleFrame[];
}
/** Committed presentation checkpoints; never accepted as commands from the client. */
export type BattleFrame = Pick<Battle, 'board' | 'fighters' | 'activeId' | 'turn' | 'phase' | 'status' | 'usedSkill' | 'pendingMatch' | 'matchedElements' | 'skillChoices' | 'boardMoves' | 'log' | 'wave' | 'winner'>;
export const createCharacterSchema = z.object({ name: z.string().trim().min(2).max(24), templateId: contentId.optional() }).strict();
export const battlefieldOptionsSchema = z.object({
  size: z.union([z.number().int(), z.object({ rows: z.number().int(), cols: z.number().int() }).strict()]).optional(),
  elementTypes: z.array(z.enum(tileTypes)).optional(),
}).strict().superRefine((options, context) => {
  try { normalizeBattlefieldOptions(options); }
  catch (error) { context.addIssue({ code: 'custom', message: (error as Error).message }); }
}).transform(options => normalizeBattlefieldOptions(options));
export const createBattleSchema = z.object({ name: z.string().trim().min(2).max(48), characterId: z.string().uuid(), kind: z.enum(['duel', 'bot', 'team', 'dungeon']), rule: z.enum(rules).default('on-match'), battlefield: battlefieldOptionsSchema.optional() }).strict();
export const joinBattleSchema = z.object({ characterId: z.string().uuid(), team: z.number().int().min(0).max(1) }).strict();
export const cellSchema = z.object({ row: z.number().int().min(0).max(MAX_FIELD_SIDE - 1), col: z.number().int().min(0).max(MAX_FIELD_SIDE - 1) }).strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('swap'), from: cellSchema, to: cellSchema, targetId: z.string().max(80).default('') }).strict(),
  z.object({ type: z.literal('skill'), skillId: z.string().max(80), targetId: z.string().max(80) }).strict(),
  z.object({ type: z.literal('end') }).strict(),
  z.object({ type: z.literal('item'), itemId: z.string().max(80) }).strict(),
]);
export const commandSchema = z.object({ characterId: z.string().uuid(), version: z.number().int().nonnegative(), action: actionSchema }).strict();
export type Action = z.infer<typeof actionSchema>;
