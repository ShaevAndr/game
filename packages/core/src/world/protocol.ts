import { worldCommandSchema } from './config';
import type { VoxelWorld, WorldOutcome, WorldPosition, WorldMotion } from './types';
import type { GatheringLoot } from '../gathering/types';
import { z } from 'zod';

export const worldIdSchema = z.string().uuid().transform(value => value.toLowerCase());
export const worldIdentitySchema = z.object({
  playerId: worldIdSchema, characterId: worldIdSchema, partyId: worldIdSchema, membershipId: worldIdSchema,
}).strict();
export type WorldIdentity = z.infer<typeof worldIdentitySchema>;
export const worldMemberSchema = worldIdentitySchema.omit({ partyId: true });
export type WorldMember = z.infer<typeof worldMemberSchema>;
export const startWorldSchema = z.object({
  worldId: worldIdSchema, operationId: worldIdSchema, actor: worldIdentitySchema,
  members: z.array(worldMemberSchema).min(1).max(6),
}).strict().superRefine((value, ctx) => {
  for (const key of ['playerId', 'characterId', 'membershipId'] as const)
    if (new Set(value.members.map(member => member[key])).size !== value.members.length)
      ctx.addIssue({ code: 'custom', message: `Повтор ${key} в составе отряда` });
  if (!value.members.some(member => member.playerId === value.actor.playerId && member.characterId === value.actor.characterId && member.membershipId === value.actor.membershipId))
    ctx.addIssue({ code: 'custom', message: 'Лидер должен входить в состав отряда' });
});
export type StartWorldRequest = z.infer<typeof startWorldSchema>;
export const executeWorldSchema = z.object({
  actor: worldIdentitySchema, command: worldCommandSchema.transform(command => ({ ...command,
    operationId: command.operationId.toLowerCase(), action: command.action.type === 'harvest'
      ? { ...command.action, toolInstanceId: command.action.toolInstanceId.toLowerCase() } : command.action,
  })),
  movement: z.object({ usedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
  build: z.object({ ownerCharacterId: worldIdSchema, recipeId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    materials: z.array(z.object({ instanceId: worldIdSchema, reservationId: worldIdSchema, itemId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), quantity: z.number().int().positive().max(10000) }).strict()).min(1).max(64),
  }).strict().optional(),
  tool: z.object({ instanceId: worldIdSchema, ownerCharacterId: worldIdSchema, toolClassId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), power: z.number().int().min(1).max(1000000), usedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.command.action.type !== 'move' && value.movement) ctx.addIssue({ code: 'custom', message: 'Допуск движения передаётся только с движением' });
  if (value.command.action.type !== 'build' && value.build) ctx.addIssue({ code: 'custom', message: 'Материалы передаются только для строительства' });
  if (value.command.action.type !== 'harvest' && value.tool)
    ctx.addIssue({ code: 'custom', message: 'Инструмент передаётся только для добычи' });
});
export type ExecuteWorldRequest = z.infer<typeof executeWorldSchema>;
/** Compact acknowledgement: persisted receipts must never retain deleted geometry. */
export interface WorldCommandResult {
  worldId: string; operationId: string; revision: number;
  motion?: { position: WorldPosition; velocity: WorldPosition; grounded: boolean; sequence: number };
  inventoryDelivery?: { status: 'imported' | 'available'; reason?: string };
  outcome: { type: WorldOutcome['type'] | 'start' | 'party'; success: boolean; hit?: WorldOutcome['hit']; loot: GatheringLoot[]; xpGained: number; manifestIds: string[] };
}
export type WorldDefinition = Pick<VoxelWorld, 'generatorRevision' | 'seed' | 'rngState' | 'catalog' | 'settings'>;
export type WorldGeometry = Pick<VoxelWorld, 'map' | 'location'>;

export function canonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry !== null && typeof entry === 'object') return Object.fromEntries(Object.entries(entry)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, normalize(item)]));
    return entry;
  };
  const result = JSON.stringify(normalize(value));
  if (result === undefined) throw new Error('Expected a JSON value');
  return result;
}
export const normalizedWorldCommandSchema = worldCommandSchema.transform(command => ({ ...command,
  operationId: command.operationId.toLowerCase(), action: command.action.type === 'harvest'
    ? { ...command.action, toolInstanceId: command.action.toolInstanceId.toLowerCase() } : command.action,
}));
export const worldPartySchema = z.object({ id: worldIdSchema, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  leaderPlayerId: worldIdSchema, members: z.array(worldMemberSchema).min(1).max(6),
}).strict().superRefine((party, ctx) => {
  if (!party.members.some(member => member.playerId === party.leaderPlayerId)) ctx.addIssue({ code: 'custom', message: 'Лидер отсутствует в группе' });
  for (const key of ['playerId', 'characterId', 'membershipId'] as const)
    if (new Set(party.members.map(member => member[key])).size !== party.members.length) ctx.addIssue({ code: 'custom', message: `Повтор ${key}` });
});
export type WorldPartySnapshot = z.infer<typeof worldPartySchema>;
export const worldDeliverySchema = z.object({
  id: worldIdSchema, worldId: worldIdSchema, sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  payload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('start'), operationId: worldIdSchema, actor: worldIdentitySchema, party: worldPartySchema }).strict(),
    z.object({ kind: z.literal('action'), request: executeWorldSchema, party: worldPartySchema }).strict(),
    z.object({ kind: z.literal('party'), party: worldPartySchema.nullable() }).strict(),
  ]),
}).strict();
export type WorldDelivery = z.infer<typeof worldDeliverySchema>;
export interface WorldDeliveryResult { status: number; body: WorldCommandResult | { message: string } }
export const worldDeliveryResultSchema = z.object({
  status: z.number().int().min(200).max(499), body: z.union([
    z.object({ worldId: worldIdSchema, operationId: worldIdSchema, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      motion: z.object({ position: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict(), velocity: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict(), grounded: z.boolean(), sequence: z.number().int().nonnegative() }).strict().optional(),
      inventoryDelivery: z.object({ status: z.enum(['imported', 'available']), reason: z.string().optional() }).strict().optional(),
      outcome: z.object({ type: z.enum(['start', 'party', 'travel', 'enter', 'leave', 'move', 'harvest', 'build', 'collect', 'close']), success: z.boolean(),
        hit: z.object({ damage: z.number().int().nonnegative(), hp: z.number().int().nonnegative(), maxHp: z.number().int().positive(), destroyed: z.boolean() }).strict().optional(),
        loot: z.array(z.object({ itemId: z.string(), quantity: z.number().int().positive() }).strict()),
        xpGained: z.number().int().nonnegative(), manifestIds: z.array(z.string()) }).strict(),
    }).strict(), z.object({ message: z.string() }).strict(),
  ]),
}).strict();
export const publicWorldStartSchema = z.object({ worldId: worldIdSchema, operationId: worldIdSchema }).strict();
