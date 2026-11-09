import { z } from 'zod';
import { worldIdSchema } from './protocol';
import type { WorldCargoManifest } from './types';
export interface WorldCargoDocument extends WorldCargoManifest {
  hash: string; status: 'pending' | 'available' | 'imported'; reason?: string; importedAt?: string;
}
export const cargoManifestIdSchema = z.string().max(112).regex(/^[a-f0-9-]{36}:[a-f0-9-]{36}:[1-9][0-9]{0,15}$/i).transform(value => value.toLowerCase());
export const cargoManifestSchema = z.object({ id: cargoManifestIdSchema, worldId: worldIdSchema, playerId: worldIdSchema, characterId: worldIdSchema,
  cargo: z.array(z.object({ itemId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(256),
}).strict().superRefine((manifest, context) => {
  if (!manifest.id.startsWith(`${manifest.worldId}:${manifest.characterId}:`)) context.addIssue({ code: 'custom', message: 'ID манифеста не соответствует владельцу и миру' });
  if (manifest.cargo.reduce((sum, item) => sum + item.quantity, 0) > 10000 || new Set(manifest.cargo.map(item => item.itemId)).size !== manifest.cargo.length)
    context.addIssue({ code: 'custom', message: 'Некорректный состав груза' });
});
export const cargoOfferSchema = z.object({ manifest: cargoManifestSchema, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type CargoOffer = z.infer<typeof cargoOfferSchema>;
const cargoIdentity = { manifestId: cargoManifestIdSchema, worldId: worldIdSchema, playerId: worldIdSchema, characterId: worldIdSchema, hash: z.string().regex(/^[a-f0-9]{64}$/) };
export const cargoImportProofSchema = z.object({ ...cargoIdentity, status: z.literal('imported'), importedAt: z.string().datetime() }).strict();
export type CargoImportProof = z.infer<typeof cargoImportProofSchema>;
export const cargoImportResultSchema = z.discriminatedUnion('status', [cargoImportProofSchema,
  z.object({ ...cargoIdentity, status: z.literal('available'), reason: z.string().max(1000) }).strict(),
]);
export type CargoImportResult = z.infer<typeof cargoImportResultSchema>;
export const publicCargoClaimSchema = z.object({ operationId: worldIdSchema, characterId: worldIdSchema }).strict();
