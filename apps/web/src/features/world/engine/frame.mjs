import { Engine } from 'noa-engine';
import { createWorldMotion, integrateWorldMovement, worldMovementRules } from '@game/core';
import { replayWorldInputs } from '../model/movement';
import { projectWorldToNoa } from '../model/noa-projection';

// Rendering and input only: shared pure physics predicts, REST confirms every input batch.
let noa, snapshot, projection, paused = false, locked = true, enabled = false, firing = false, jumpQueued = false;
let lastHit = 0, previousTarget = '', eyeHeight = 0, accumulator = 0, predicted, previous, baseline;
let inputs = [], awaiting = false, sentUntil = 0;
const registered = new Set(), keys = new Set();
const send = (type, data = {}) => parent.postMessage({ channel: 'game-world', type, ...data }, location.origin);
const solid = p => projection.voxel(p) !== 0;
const target = () => { const p = noa?.targetedBlock?.position; return p ? { x: p[0], y: p[1], z: p[2] } : null; };
function replay() {
  if (!baseline) return;
  const oldPosition = predicted?.position, oldPrevious = previous;
  predicted = replayWorldInputs(baseline, inputs, solid, snapshot.region.blockSizeMeters);
  previous = oldPosition && Math.hypot(oldPosition.x - predicted.position.x, oldPosition.y - predicted.position.y, oldPosition.z - predicted.position.z) < .00001 ? oldPrevious : { ...predicted.position };
}
function release() {
  keys.clear(); firing = false; jumpQueued = false;
  if (!noa) return;
  noa.container.setPointerLock(false);
  for (const binding of Object.keys(noa.inputs.state)) noa.inputs.state[binding] = false;
}
function pause(value) {
  paused = value;
  if (!noa) return;
  if (value) { release(); inputs = inputs.filter(input => input.sequence <= sentUntil); replay(); accumulator = 0; }
  noa.inputs.disabled = value; noa.inputs.preventDefaults = !value; noa.setPaused(value);
}
function action(type) {
  if (!noa || paused || locked || !document.pointerLockElement || !noa.targetedBlock) return;
  const p = type === 'build' ? noa.targetedBlock.adjacent : noa.targetedBlock.position;
  send(type, { position: { x: p[0], y: p[1], z: p[2] } });
}
function direction() {
  if (!document.pointerLockElement) return { x: 0, z: 0 };
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const heading = noa.camera.heading;
  return { x: (Math.sin(heading) * forward + Math.cos(heading) * right) / Math.max(1, Math.hypot(forward, right)),
    z: (Math.cos(heading) * forward - Math.sin(heading) * right) / Math.max(1, Math.hypot(forward, right)) };
}
function initialize(next) {
  const p = next.position, scale = next.region.blockSizeMeters;
  projection = projectWorldToNoa(next.region, p);
  noa = new Engine({ domElement: document.querySelector('#world'), playerStart: [p.x, p.y, p.z],
    playerWidth: worldMovementRules.widthMeters / scale, playerHeight: worldMovementRules.heightMeters / scale,
    chunkSize: 8, chunkAddDistance: [2, 1], chunkRemoveDistance: [3, 2], blockTestDistance: worldMovementRules.reachMeters / scale + 1,
    maxRenderRate: 60, stickyPointerLock: false, playerShadowComponent: false, clearColor: [.55, .73, .82], preventDefaults: true, silent: true,
    bindings: {} });
  for (const component of ['receivesInputs', 'movement', 'physics']) noa.entities.removeComponent(noa.playerEntity, component);
  eyeHeight = worldMovementRules.heightMeters / scale * .9;
  noa.entities.removeComponent(noa.camera.cameraTarget, 'followsEntity');
  noa.registry.registerBlock(1, { solid: true, opaque: true });
  noa.blockTargetIdCheck = id => id > 1;
  noa.world.on('worldDataNeeded', (id, data, x, y, z) => {
    for (let i = 0; i < data.shape[0]; i++) for (let j = 0; j < data.shape[1]; j++) for (let k = 0; k < data.shape[2]; k++)
      data.set(i, j, k, projection.voxel({ x: x + i, y: y + j, z: z + k }));
    noa.world.setChunkData(id, data);
  });
  noa.on('beforeRender', dt => {
    if (!predicted || !snapshot) return;
    const input = direction();
    accumulator = Math.min(100, accumulator + Math.max(0, dt));
    while (accumulator >= worldMovementRules.frameMs) {
      accumulator -= worldMovementRules.frameMs;
      if (!enabled || inputs.length >= 8 || (!input.x && !input.z && !jumpQueued && predicted.motion.grounded)) { previous = { ...predicted.position }; continue; }
      const frame = { sequence: predicted.motion.sequence + 1, ...input, jump: jumpQueued };
      jumpQueued = false; previous = { ...predicted.position };
      predicted = integrateWorldMovement(predicted.position, predicted.motion, frame, solid, scale); inputs.push(frame);
    }
    const alpha = accumulator / worldMovementRules.frameMs;
    const p = { x: previous.x + (predicted.position.x - previous.x) * alpha, y: previous.y + (predicted.position.y - previous.y) * alpha, z: previous.z + (predicted.position.z - previous.z) * alpha };
    noa.entities.setPosition(noa.playerEntity, [p.x, p.y, p.z]);
    noa.entities.setPosition(noa.camera.cameraTarget, [p.x, p.y + eyeHeight, p.z]);
    const positionInfo = document.querySelector('#position-info');
    positionInfo.textContent = `X ${(p.x * scale).toFixed(2)} · Y ${(p.y * scale).toFixed(2)} · Z ${(p.z * scale).toFixed(2)} м`;
    for (const axis of ['x', 'y', 'z']) positionInfo.dataset[axis] = String(p[axis] * scale);
    positionInfo.dataset.grounded = String(predicted.motion.grounded);
    const now = performance.now();
    if (!locked && firing && now - lastHit >= 300) { lastHit = now; action('hit'); }
    else if (enabled && !locked && !awaiting && inputs.length && (inputs.length >= 2 || (!input.x && !input.z && predicted.motion.grounded))) {
      const batch = inputs.slice(0, worldMovementRules.maxFrames); awaiting = true; sentUntil = batch.at(-1).sequence;
      send('move', { frames: batch });
    }
  });
  noa.on('afterRender', () => {
    const p = target(), key = JSON.stringify(p);
    if (key !== previousTarget) { previousTarget = key; send('target', { position: p }); }
    document.querySelector('#hint').hidden = !!document.pointerLockElement || paused;
  });
  const canvas = document.querySelector('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Мир от первого лица');
  noa.container.element.addEventListener('pointerdown', event => {
    if (!paused && document.pointerLockElement) { if (event.button === 0) firing = true; else if (event.button === 2) action('build'); }
  });
  document.addEventListener('pointerup', event => { if (event.button === 0) firing = false; });
  noa.container.element.addEventListener('pointercancel', () => { firing = false; });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { firing = false; keys.clear(); jumpQueued = false; } });
  canvas.addEventListener('click', () => { if (!paused && !document.pointerLockElement) noa.container.setPointerLock(true); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); release(); send('failed'); });
  send('ready');
}
function sync(next) {
  if (snapshot && next.revision < snapshot.revision) return;
  if (!noa) initialize(next);
  const old = projection;
  projection = projectWorldToNoa(next.region, next.position, old.types);
  for (const block of next.region.palette) if (!registered.has(block.id)) {
    const rgb = block.color.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
    noa.registry.registerMaterial(block.id, { color: rgb });
    noa.registry.registerBlock(projection.types.get(block.id), { material: block.id }); registered.add(block.id);
  }
  if (!snapshot || next.region.revision !== snapshot.region.revision) {
    const size = next.region.size;
    for (let x = 0; x < size.x; x++) for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) {
      const p = { x, y, z }, value = projection.voxel(p); if (value !== old.voxel(p)) noa.setBlock(value, x, y, z);
    }
  }
  const motion = next.motion ?? createWorldMotion(next.position, solid, next.region.blockSizeMeters);
  const reset = snapshot && next.motionReset !== snapshot.motionReset;
  if (reset) { inputs = []; awaiting = false; sentUntil = motion.sequence; }
  if (!snapshot || next.revision !== snapshot.revision || reset) {
    baseline = { position: { ...next.position }, motion: structuredClone(motion) };
    inputs = inputs.filter(input => input.sequence > motion.sequence);
    if (motion.sequence >= sentUntil) awaiting = false;
    const previousSnapshot = snapshot; snapshot = next; replay(); snapshot = previousSnapshot;
  }
  snapshot = next; locked = next.locked; enabled = next.movementEnabled;
  if (!enabled && !next.locked && !paused) { inputs = []; awaiting = false; replay(); }
  document.querySelector('#hp-readout').textContent = next.targetMaxHp ? `HP ${next.targetHp} / ${next.targetMaxHp}` : '';
  const bar = document.querySelector('#block-hp'); bar.hidden = !next.targetMaxHp; bar.max = next.targetMaxHp ?? 100; bar.value = next.targetHp ?? 0;
  document.querySelector('#target-info').textContent = next.targetInfo ?? '';
  document.querySelector('#feedback').textContent = next.feedback ?? '';
  document.querySelector('#cargo-info').textContent = next.cargoInfo ?? '';
  document.querySelector('#feedback').classList.toggle('error', !!next.error);
  if (next.paused !== paused) pause(next.paused);
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== 'game-world') return;
  try {
    if (event.data.type === 'snapshot') sync(event.data);
    if (event.data.type === 'release') release();
    if (event.data.type === 'motion-rejected') { inputs = []; awaiting = false; replay(); }
  } catch { release(); send('failed'); }
});
window.addEventListener('keydown', event => {
  if (event.code === 'KeyI' && !event.repeat) { event.preventDefault(); pause(true); send('inventory'); return; }
  if (event.code === 'Escape') { release(); return; }
  if (!paused) { keys.add(event.code); if (event.code === 'Space' && !event.repeat && document.pointerLockElement && enabled) { jumpQueued = true; event.preventDefault(); } }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { firing = false; keys.clear(); jumpQueued = false; });
send('loaded');
