import type { VoxelPosition, WorldPosition, WorldMotion, WorldInputFrame, WorldRegion } from './types';
import { insideRegion, worldBlockAt } from './voxels';

export const worldMovementRules = { widthMeters: .6, heightMeters: 1.8, speedMeters: 2.5, jumpMeters: 5.5,
  gravityMeters: 20, stepMeters: .5, frameMs: 50, maxFrames: 4, reachMeters: 2 } as const;
export type WorldSolid = (position: VoxelPosition) => boolean;
const axes = ['x', 'y', 'z'] as const;
const epsilon = 1e-7;
export const worldVoxel = (p: WorldPosition): VoxelPosition => ({ x: Math.floor(p.x), y: Math.floor(p.y + epsilon), z: Math.floor(p.z) });
export const worldSpawnPosition = (p: VoxelPosition): WorldPosition => ({ x: p.x + .5, y: p.y, z: p.z + .5 });
export const worldRegionSolid = (region: WorldRegion): WorldSolid => p => !insideRegion(region, p) || worldBlockAt(region, p) !== null;
export function worldBodyBounds(p: WorldPosition, scale: number) {
  const half = worldMovementRules.widthMeters / scale / 2;
  return { min: { x: p.x - half, y: p.y, z: p.z - half }, max: { x: p.x + half, y: p.y + worldMovementRules.heightMeters / scale, z: p.z + half } };
}
export function worldBodyIntersects(p: WorldPosition, block: VoxelPosition, scale: number) {
  const box = worldBodyBounds(p, scale);
  return axes.every(axis => box.max[axis] > block[axis] + epsilon && box.min[axis] < block[axis] + 1 - epsilon);
}
export function worldBodyCollides(p: WorldPosition, solid: WorldSolid, scale: number) {
  const box = worldBodyBounds(p, scale);
  for (let x = Math.floor(box.min.x + epsilon); x < Math.ceil(box.max.x - epsilon); x++)
    for (let y = Math.floor(box.min.y + epsilon); y < Math.ceil(box.max.y - epsilon); y++)
      for (let z = Math.floor(box.min.z + epsilon); z < Math.ceil(box.max.z - epsilon); z++) if (solid({ x, y, z })) return true;
  return false;
}
export const worldBodyGrounded = (p: WorldPosition, solid: WorldSolid, scale: number) =>
  !worldBodyCollides(p, solid, scale) && worldBodyCollides({ ...p, y: p.y - .001 }, solid, scale);
/** Bounded substeps prevent tunnelling, including a long fall or a diagonal wall slide. */
function sweep(p: WorldPosition, axis: keyof WorldPosition, amount: number, solid: WorldSolid, scale: number) {
  const result = { ...p }, steps = Math.max(1, Math.ceil(Math.abs(amount) / .1));
  for (let i = 0; i < steps; i++) {
    const next = { ...result, [axis]: result[axis] + amount / steps };
    if (worldBodyCollides(next, solid, scale)) {
      let low = 0, high = 1;
      for (let n = 0; n < 16; n++) { const mid = (low + high) / 2;
        if (worldBodyCollides({ ...result, [axis]: result[axis] + amount / steps * mid }, solid, scale)) high = mid; else low = mid; }
      result[axis] += amount / steps * low; return { position: result, blocked: true };
    }
    result[axis] = next[axis];
  }
  return { position: result, blocked: false };
}
export function createWorldMotion(p: WorldPosition, solid: WorldSolid, scale: number): WorldMotion {
  return { velocity: { x: 0, y: 0, z: 0 }, grounded: worldBodyGrounded(p, solid, scale), sequence: 0 };
}
/** Shared fixed-step physics. The browser predicts with public solids; the server uses full terrain. */
export function integrateWorldMovement(p: WorldPosition, motion: WorldMotion, input: WorldInputFrame, solid: WorldSolid, scale: number) {
  const dt = worldMovementRules.frameMs / 1000, length = Math.max(1, Math.hypot(input.x, input.z));
  const grounded = worldBodyGrounded(p, solid, scale);
  const velocity = { x: input.x / length * worldMovementRules.speedMeters / scale,
    y: (input.jump && grounded ? worldMovementRules.jumpMeters / scale : grounded && motion.velocity.y < 0 ? 0 : motion.velocity.y) - worldMovementRules.gravityMeters / scale * dt,
    z: input.z / length * worldMovementRules.speedMeters / scale };
  const horizontal = (start: WorldPosition) => {
    const x = sweep(start, 'x', velocity.x * dt, solid, scale), z = sweep(x.position, 'z', velocity.z * dt, solid, scale);
    return { position: z.position, blocked: x.blocked || z.blocked };
  };
  let travel = horizontal(p);
  if (travel.blocked && grounded && !input.jump && (input.x || input.z)) {
    const lift = sweep(p, 'y', worldMovementRules.stepMeters / scale, solid, scale);
    if (!lift.blocked) {
      const raised = horizontal(lift.position), drop = sweep(raised.position, 'y', -worldMovementRules.stepMeters / scale, solid, scale);
      if (!raised.blocked && drop.blocked) travel = { position: drop.position, blocked: false };
    }
  }
  const vertical = sweep(travel.position, 'y', velocity.y * dt, solid, scale);
  if (vertical.blocked) velocity.y = 0;
  const next: WorldMotion = { ...motion, velocity, grounded: worldBodyGrounded(vertical.position, solid, scale), sequence: input.sequence };
  return { position: vertical.position, motion: next };
}
export function applyWorldMovement(region: WorldRegion, p: WorldPosition, saved: WorldMotion | undefined, frames: WorldInputFrame[], scale: number, usedAt: number) {
  const solid = worldRegionSolid(region); let position = { ...p }, motion = saved ?? createWorldMotion(p, solid, scale);
  const duration = frames.length * worldMovementRules.frameMs;
  const clock = Math.max(motion.simulatedAt ?? usedAt - duration, usedAt - worldMovementRules.frameMs * worldMovementRules.maxFrames);
  if (!Number.isSafeInteger(usedAt) || usedAt < 0 || duration > usedAt - clock + worldMovementRules.frameMs) throw new Error('Слишком частые команды движения');
  for (const frame of frames) {
    if (frame.sequence !== motion.sequence + 1) throw new Error('Нарушена последовательность движения');
    ({ position, motion } = integrateWorldMovement(position, motion, frame, solid, scale));
  }
  motion.simulatedAt = clock + duration;
  return { position, motion };
}
export function worldBlockReachable(p: WorldPosition, target: VoxelPosition, scale: number) {
  const eye = { x: p.x, y: p.y + worldMovementRules.heightMeters / scale * .9, z: p.z };
  const distance = Math.hypot(...axes.map(axis => Math.max(target[axis] - eye[axis], 0, eye[axis] - target[axis] - 1)));
  return distance * scale <= worldMovementRules.reachMeters + epsilon;
}
export function worldBlockVisible(region: WorldRegion, p: WorldPosition, target: VoxelPosition, scale: number) {
  if (!worldBlockReachable(p, target, scale)) return false;
  const eye = { x: p.x, y: p.y + worldMovementRules.heightMeters / scale * .9, z: p.z }, end = { x: target.x + .5, y: target.y + .5, z: target.z + .5 };
  const steps = Math.ceil(Math.hypot(end.x - eye.x, end.y - eye.y, end.z - eye.z) / .1);
  for (let i = 0; i < steps; i++) {
    const t = i / steps, voxel = worldVoxel({ x: eye.x + (end.x - eye.x) * t, y: eye.y + (end.y - eye.y) * t, z: eye.z + (end.z - eye.z) * t });
    if (axes.every(axis => voxel[axis] === target[axis])) return true;
    if (!insideRegion(region, voxel) || worldBlockAt(region, voxel) !== null) return false;
  }
  return true;
}
export function findWorldEntry(region: WorldRegion, scale: number, near: WorldPosition = worldSpawnPosition(region.spawn)): WorldPosition {
  const solid = worldRegionSolid(region), origin = near;
  for (let radius = 0; radius < Math.max(region.size.x, region.size.z); radius++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
    for (let y = Math.min(region.size.y - 1, Math.ceil(near.y) + 2); y >= 1; y--) {
      const candidate = { x: origin.x + dx, y, z: origin.z + dz };
      if (worldBodyGrounded(candidate, solid, scale)) return candidate;
    }
  }
  throw new Error('Точка входа недоступна');
}
