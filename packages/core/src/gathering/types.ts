import { z } from 'zod';

export type ResourceType = 'plant' | 'tree' | 'mineral' | 'crystal';
export interface GatheringLoot { itemId: string; quantity: number }
export interface GatheringMethod {
  id: string; name: string; toolItemId?: string; output: GatheringLoot;
  bonus?: GatheringLoot & { chanceBps: number };
}
export interface GatheringResource {
  id: string; name: string; type: ResourceType; level: number; hint: string;
  methods: GatheringMethod[];
}
export interface GatheringRoute { id: string; name: string; description: string; commonResourceId: string; resourceIds: string[] }
export interface GatheringArea { id: string; name: string; description: string; routes: GatheringRoute[] }
export interface GatheringCatalog { areas: GatheringArea[]; resources: GatheringResource[] }
export interface GatheringExpedition {
  id: string; areaId: string; routeId: string; step: number; sites: string[][]; cargo: GatheringLoot[];
}
export interface GatheringState {
  revision: number; xp: number; discoveredResourceIds: string[]; expedition: GatheringExpedition | null;
}
export interface GatheringMethodView extends GatheringMethod { enabled: boolean; reason?: string }
export interface GatheringResourceView extends Omit<GatheringResource, 'methods'> { methods: GatheringMethodView[] }
export interface GatheringView {
  revision: number; xp: number; level: number; nextLevelXp: number | null; cargoCapacity: number;
  areas: GatheringArea[]; atlas: GatheringResource[];
  expedition: (Omit<GatheringExpedition, 'sites'> & { totalSteps: number; resources: GatheringResourceView[] }) | null;
  itemNames: Record<string, string>;
}
export interface GatheringReceipt { view: GatheringView; outcome: { type: GatheringAction['type']; success: boolean; loot: GatheringLoot[] } }
const contentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const gatheringActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), areaId: contentId, routeId: contentId }).strict(),
  z.object({ type: z.literal('harvest'), resourceId: contentId, methodId: contentId }).strict(),
  z.object({ type: z.literal('skip') }).strict(),
  z.object({ type: z.literal('return') }).strict(),
]);
export type GatheringAction = z.infer<typeof gatheringActionSchema>;
export const gatheringCommandSchema = z.object({
  operationId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), action: gatheringActionSchema,
}).strict();
export type GatheringCommand = z.infer<typeof gatheringCommandSchema>;
