import { cargoManifestIdSchema, publicCargoClaimSchema, publicWorldStartSchema, worldCommandSchema, worldIdSchema, type WorldCommand } from '@game/core';
export type PendingWorldCommand = { kind: 'start'; request: { worldId: string; operationId: string } }
  | { kind: 'action'; worldId: string; command: WorldCommand }
  | { kind: 'claim'; manifestId: string; command: { operationId: string; characterId: string } };
export function parsePendingWorldCommand(value: string | null): PendingWorldCommand | null {
  try {
    const input = JSON.parse(value ?? 'null');
    if (input?.kind === 'start') return { kind: 'start', request: publicWorldStartSchema.parse(input.request) };
    if (input?.kind === 'action') return { kind: 'action', worldId: worldIdSchema.parse(input.worldId), command: worldCommandSchema.parse(input.command) };
    if (input?.kind === 'claim') return { kind: 'claim', manifestId: cargoManifestIdSchema.parse(input.manifestId), command: publicCargoClaimSchema.parse(input.command) };
  } catch { /* Invalid browser storage cannot become an admitted command. */ }
  return null;
}
export const pendingOperationId = (pending: PendingWorldCommand) => pending.kind === 'start' ? pending.request.operationId : pending.command.operationId;
