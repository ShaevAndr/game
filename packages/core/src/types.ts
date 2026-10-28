import { z } from 'zod';

export const elements = ['fire', 'water', 'earth', 'air', 'physical'] as const;
export type Element = typeof elements[number];
export const elementNames: Record<Element, string> = { fire: 'Огонь', water: 'Вода', earth: 'Земля', air: 'Воздух', physical: 'Сила' };
export type Energy = Record<Element, number>;
export const emptyEnergy = (): Energy => ({ fire: 0, water: 0, earth: 0, air: 0, physical: 0 });
export interface Stats { maxHp: number; attack: number; defense: number; maxEnergy: number }
export interface Item { id: string; name: string; description: string; heal: number }
export interface ItemStack { itemId: string; quantity: number }
export interface Character { id: string; name: string; level: number; experience: number; skillPoints: number; learnedSkillIds: string[]; stats: Stats; energy: Energy; inventory: ItemStack[]; createdAt: string }
export interface SkillLearning { pointCost: number; level: number; prerequisites: string[]; stats: Partial<Stats>; starter: boolean }
export interface Skill { id: string; name: string; description: string; element: Element; cost: number; power: number; effect: 'damage' | 'heal'; cooldown: number; learning: SkillLearning }
export interface Enemy { id: string; name: string; stats: Stats; skillIds: string[] }
export interface Progression { baseExperience: number; experiencePerLevel: number; startingSkillPoints: number; skillPointsPerLevel: number; statGrowth: Stats; victoryExperience: Record<BattleKind, number> }
export interface Balance { characterStats: Stats; starterItems: ItemStack[]; damagePerTile: number; energyPerTile: number; teamSize: number; dungeonWaves: string[]; progression: Progression }
export interface Content { skills: Skill[]; items: Item[]; enemies: Enemy[]; balance: Balance }
const statsSchema = z.object({ maxHp: z.number().int().positive().max(100000), attack: z.number().int().nonnegative().max(10000), defense: z.number().int().nonnegative().max(10000), maxEnergy: z.number().int().positive().max(10000) });
const contentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const learningSchema = z.object({ pointCost: z.number().int().min(1).max(100), level: z.number().int().min(1).max(1000), prerequisites: z.array(contentId).max(20), stats: statsSchema.partial(), starter: z.boolean() });
export const progressionSchema = z.object({ baseExperience: z.number().int().min(1).max(1000000), experiencePerLevel: z.number().int().min(0).max(1000000), startingSkillPoints: z.number().int().min(0).max(1000), skillPointsPerLevel: z.number().int().min(1).max(100), statGrowth: z.object({ maxHp: z.number().int().min(0).max(1000), attack: z.number().int().min(0).max(1000), defense: z.number().int().min(0).max(1000), maxEnergy: z.number().int().min(0).max(1000) }), victoryExperience: z.object({ duel: z.number().int().positive().max(1000000), team: z.number().int().positive().max(1000000), dungeon: z.number().int().positive().max(1000000) }) });
export const contentSchema = z.object({
  skills: z.array(z.object({ id: contentId, name: z.string().min(1).max(80), description: z.string().max(500), element: z.enum(elements), cost: z.number().int().nonnegative().max(10000), power: z.number().int().nonnegative().max(10000), effect: z.enum(['damage', 'heal']), cooldown: z.number().int().nonnegative().max(100), learning: learningSchema })).min(1),
  items: z.array(z.object({ id: contentId, name: z.string().min(1).max(80), description: z.string().max(500), heal: z.number().int().positive().max(10000) })),
  enemies: z.array(z.object({ id: contentId, name: z.string().min(1).max(80), stats: statsSchema, skillIds: z.array(contentId).min(1) })).min(1),
  balance: z.object({ characterStats: statsSchema, starterItems: z.array(z.object({ itemId: contentId, quantity: z.number().int().nonnegative().max(1000) })), damagePerTile: z.number().int().positive().max(100), energyPerTile: z.number().int().positive().max(100), teamSize: z.number().int().min(1).max(10), dungeonWaves: z.array(contentId).min(1).max(100), progression: progressionSchema }),
}).superRefine((content, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const basic = content.skills.find(s => s.cost === 0 && s.cooldown === 0 && s.effect === 'damage' && s.learning.starter);
  if (!basic) fail('Нужен бесплатный атакующий навык без перезарядки');
  const skills = new Map(content.skills.map(s => [s.id, s]));
  if (skills.size !== content.skills.length) fail('ID навыков должны быть уникальными');
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
    if (!e.skillIds.some(id => content.skills.some(s => s.id === id && s.cost === 0 && s.cooldown === 0 && s.effect === 'damage'))) fail(`Противнику ${e.id} нужен бесплатный атакующий навык`);
    if (e.skillIds.some(id => !content.skills.some(s => s.id === id))) fail(`Неизвестный навык противника ${e.id}`);
  }
  for (const id of content.balance.dungeonWaves) if (!content.enemies.some(e => e.id === id)) fail(`Неизвестный противник ${id}`);
  for (const item of content.balance.starterItems) if (!content.items.some(i => i.id === item.itemId)) fail(`Неизвестный предмет ${item.itemId}`);
});
export const rules = ['before', 'before-after', 'on-match'] as const;
export type Rule = typeof rules[number];
export type BattleKind = 'duel' | 'team' | 'dungeon';
export interface Fighter { id: string; characterId?: string; name: string; team: number; npc: boolean; stats: Stats; hp: number; energy: Energy; inventory: ItemStack[]; cooldowns: Record<string, number>; skillIds: string[] }
export type Board = Element[][];
export interface Battle {
  id: string; name: string; kind: BattleKind; rule: Rule; status: 'waiting' | 'active' | 'finished';
  version: number; board: Board; fighters: Fighter[]; activeId: string | null; turn: number;
  phase: 'before' | 'after' | 'choose'; usedSkill: boolean; pendingMatch: number;
  wave: number; totalWaves: number; winner: number | null; log: string[]; content: Content; createdAt: string;
  rewards?: { characterId: string; experience: number; levelsGained: number }[];
}
export const createCharacterSchema = z.object({ name: z.string().trim().min(2).max(24) }).strict();
export const createBattleSchema = z.object({ name: z.string().trim().min(2).max(48), characterId: z.string().uuid(), kind: z.enum(['duel', 'team', 'dungeon']), rule: z.enum(rules) }).strict();
export const joinBattleSchema = z.object({ characterId: z.string().uuid(), team: z.number().int().min(0).max(1) }).strict();
export const cellSchema = z.object({ row: z.number().int().min(0).max(7), col: z.number().int().min(0).max(7) }).strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('swap'), from: cellSchema, to: cellSchema, targetId: z.string().max(80) }).strict(),
  z.object({ type: z.literal('skill'), skillId: z.string().max(80), targetId: z.string().max(80) }).strict(),
  z.object({ type: z.literal('end') }).strict(),
  z.object({ type: z.literal('item'), itemId: z.string().max(80) }).strict(),
]);
export const commandSchema = z.object({ characterId: z.string().uuid(), version: z.number().int().nonnegative(), action: actionSchema }).strict();
export type Action = z.infer<typeof actionSchema>;
