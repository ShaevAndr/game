import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorldMovement, createWorldMotion, integrateWorldMovement, worldBodyCollides, worldBodyGrounded, worldRegionSolid, writeWorldBlock, worldActionSchema,
  type WorldInputFrame, type WorldRegion, type WorldPosition } from '../src';
function terrain() {
  const size = { x: 16, y: 16, z: 16 };
  const region: WorldRegion = { cellId: '0:0', seed: 1, revision: 0, size, chunkSize: size, spawn: { x: 8, y: 2, z: 8 },
    chunks: [{ position: { x: 0, y: 0, z: 0 }, size, palette: [null, 'stone'], blocks: Array(4096).fill(0) }] };
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) writeWorldBlock(region, { x, y: 1, z }, 'stone');
  return region;
}
const frame = (sequence: number, x = 0, z = 0, jump = false): WorldInputFrame => ({ sequence, x, z, jump });
test('free movement uses fractional coordinates, arbitrary headings, and equal diagonal speed', () => {
  const region = terrain(), solid = worldRegionSolid(region), p = { x: 8.5, y: 2, z: 8.5 }, motion = createWorldMotion(p, solid, .5);
  const straight = integrateWorldMovement(p, motion, frame(1, 1), solid, .5), diagonal = integrateWorldMovement(p, motion, frame(1, 1, 1), solid, .5);
  assert.ok(straight.position.x > p.x && straight.position.x < p.x + .5);
  assert.ok(diagonal.position.x > p.x && diagonal.position.z > p.z);
  assert.ok(Math.abs(Math.hypot(diagonal.position.x - p.x, diagonal.position.z - p.z) - (straight.position.x - p.x)) < 1e-6);
  const angle = integrateWorldMovement(p, motion, frame(1, Math.cos(.3), Math.sin(.3)), solid, .5);
  assert.ok(Math.abs((angle.position.z - p.z) / (angle.position.x - p.x) - Math.tan(.3)) < 1e-6);
  assert.equal(worldActionSchema.safeParse({ type: 'move', position: { x: 9, y: 2, z: 8 } }).success, false);
});
test('jumping allows horizontal steering in flight, lands on terrain and cannot double-jump', () => {
  const region = terrain(), solid = worldRegionSolid(region); let state = { position: { x: 8.5, y: 2, z: 8.5 }, motion: createWorldMotion({ x: 8.5, y: 2, z: 8.5 }, solid, .5) };
  state = integrateWorldMovement(state.position, state.motion, frame(1, 0, 0, true), solid, .5);
  assert.ok(state.position.y > 2); assert.equal(state.motion.grounded, false);
  const airborne = { ...state.position }, velocity = state.motion.velocity.y;
  state = integrateWorldMovement(state.position, state.motion, frame(2, .6, .8, true), solid, .5);
  assert.ok(state.position.x > airborne.x && state.position.z > airborne.z); assert.ok(state.motion.velocity.y < velocity);
  for (let i = 3; i < 60 && !state.motion.grounded; i++) state = integrateWorldMovement(state.position, state.motion, frame(i), solid, .5);
  assert.equal(state.motion.grounded, true); assert.ok(Math.abs(state.position.y - 2) < 1e-5);
});
test('swept character volume blocks walls, ceiling and region escape and steps over a half-metre cube', () => {
  const region = terrain(), solid = worldRegionSolid(region), start = { x: 8.5, y: 2, z: 8.5 };
  for (let y = 2; y < 12; y++) for (let z = 0; z < 16; z++) writeWorldBlock(region, { x: 10, y, z }, 'stone');
  let state = { position: start, motion: createWorldMotion(start, solid, .5) };
  for (let i = 1; i <= 30; i++) state = integrateWorldMovement(state.position, state.motion, frame(i, 1), solid, .5);
  assert.ok(state.position.x <= 9.40001); assert.equal(worldBodyCollides(state.position, solid, .5), false);
  const stairs = terrain(); writeWorldBlock(stairs, { x: 10, y: 2, z: 8 }, 'stone'); writeWorldBlock(stairs, { x: 10, y: 2, z: 9 }, 'stone');
  const stairsSolid = worldRegionSolid(stairs); state = { position: start, motion: createWorldMotion(start, stairsSolid, .5) };
  for (let i = 1; i <= 7; i++) state = integrateWorldMovement(state.position, state.motion, frame(i, 1), stairsSolid, .5);
  assert.ok(state.position.y > 2.9); assert.ok(state.position.x > 9.4);
  const ceiling = terrain(); for (let x = 7; x <= 9; x++) for (let z = 7; z <= 9; z++) writeWorldBlock(ceiling, { x, y: 6, z }, 'stone');
  const ceilingSolid = worldRegionSolid(ceiling); state = { position: start, motion: createWorldMotion(start, ceilingSolid, .5) };
  for (let i = 1; i <= 12; i++) { state = integrateWorldMovement(state.position, state.motion, frame(i, 0, 0, i === 1), ceilingSolid, .5); assert.ok(state.position.y <= 2.40001); }
});
test('server input admission limits simulated time and rejects a missing or repeated sequence', () => {
  const region = terrain(), p = { x: 8.5, y: 2, z: 8.5 };
  const first = applyWorldMovement(region, p, undefined, [frame(1, .5, .5), frame(2, .5, .5)], .5, 1000);
  assert.equal(first.motion.sequence, 2);
  assert.throws(() => applyWorldMovement(region, first.position, first.motion, [frame(3), frame(4), frame(5), frame(6)], .5, 1001), /частые/);
  assert.throws(() => applyWorldMovement(region, first.position, first.motion, [frame(2)], .5, 1100), /последовательность/);
  const next = applyWorldMovement(region, first.position, first.motion, [frame(3)], .5, 1100);
  assert.equal(next.motion.sequence, 3);
});
