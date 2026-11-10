import { integrateWorldMovement, type WorldInputFrame, type WorldMotion, type WorldPosition, type WorldSolid } from '@game/core';
export function replayWorldInputs(baseline: { position: WorldPosition; motion: WorldMotion }, frames: WorldInputFrame[], solid: WorldSolid, scale: number) {
  let state = { position: { ...baseline.position }, motion: { ...baseline.motion, velocity: { ...baseline.motion.velocity } } };
  for (const frame of frames) {
    if (frame.sequence <= baseline.motion.sequence) continue;
    if (frame.sequence !== state.motion.sequence + 1) throw new Error('Нарушена последовательность локального движения');
    state = integrateWorldMovement(state.position, state.motion, frame, solid, scale);
  }
  return state;
}
