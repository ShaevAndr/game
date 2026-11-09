import { Engine } from 'noa-engine';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { projectToNoa, key, intervalMs } from './projection.mjs';
import { createInventoryUI } from './inventory-ui.mjs';

const first = await fetch('/probe-api');
if (!first.ok) throw new Error((await first.json()).error);
let snapshot = await first.json(), projection = projectToNoa(snapshot.view, snapshot.knownAir);
let mode = 'item', selectedRecipe = snapshot.catalog.recipes[0]?.id, sending = false, lastAttempt = 0, frames = 0, chunks = 0;
let pending = null;
try { pending = JSON.parse(sessionStorage.getItem('noa-pending-operation') ?? 'null'); } catch { sessionStorage.removeItem('noa-pending-operation'); }
const actor = () => document.querySelector('#actor').value, definitions = () => new Map(snapshot.catalog.items.map(item => [item.id, item]));
const items = () => snapshot.inventory[actor()], held = () => items().find(item => item.id === snapshot.selectedItems[actor()]);
const host = document.querySelector('#game'), spawn = snapshot.view.location.position;
const noa = new Engine({ domElement: host, playerStart: [spawn.x + .5, spawn.y, spawn.z + .5],
  chunkSize: 8, chunkAddDistance: [2, 1], chunkRemoveDistance: [3, 2], blockTestDistance: 5,
  maxRenderRate: 60, stickyPointerLock: true, playerAutoStep: true, playerShadowComponent: false,
  clearColor: [.55, .73, .82], preventDefaults: true, silent: true });
noa.registry.registerBlock(1, { solid: true, opaque: true });
const registered = new Set();
function registerPalette() {
  for (const block of snapshot.view.region.palette) if (!registered.has(block.id)) {
    const rgb = block.color.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
    noa.registry.registerMaterial(block.id, { color: rgb });
    noa.registry.registerBlock(projection.types.get(block.id), { material: block.id }); registered.add(block.id);
  }
}
registerPalette(); noa.blockTargetIdCheck = id => id > 1;
noa.inputs.unbind('alt-fire'); noa.inputs.bind('alt-fire', 'Mouse3');
noa.world.on('worldDataNeeded', (id, data, x, y, z) => {
  for (let i = 0; i < data.shape[0]; i++) for (let j = 0; j < data.shape[1]; j++) for (let k = 0; k < data.shape[2]; k++)
    data.set(i, j, k, projection.voxel({ x: x + i, y: y + j, z: z + k }));
  noa.world.setChunkData(id, data); chunks++;
});
const ui = createInventoryUI({
  onSelect: id => { void mutate({ type: 'select', instanceId: id }).then(ok => { if (ok) { mode = 'item'; renderInventory(); } }); },
  onDrop: (id, quantity) => { void mutate({ type: 'drop', instanceId: id, quantity }); },
  onRecipe: id => { selectedRecipe = id; mode = 'build'; renderInventory(); notice('Чертёж выбран. Закрой рюкзак и установи блок через ПКМ.'); },
  onClose: closeInventory,
});
function notice(message) {
  document.querySelector('#notice').textContent = message; document.querySelector('#inventory-message').textContent = message;
}
function renderInventory() { if (ui.dialog.open) ui.render(snapshot, actor(), mode === 'build' ? selectedRecipe : null, sending || !!pending); }
function openInventory() {
  if (ui.dialog.open) return;
  noa.container.setPointerLock(false); noa.setPaused(true); noa.inputs.disabled = true; noa.inputs.preventDefaults = false;
  for (const binding of Object.keys(noa.inputs.state)) noa.inputs.state[binding] = false;
  ui.dialog.showModal(); renderInventory();
}
function closeInventory() {
  ui.dialog.close(); noa.inputs.disabled = false; noa.inputs.preventDefaults = true;
  for (const binding of Object.keys(noa.inputs.state)) noa.inputs.state[binding] = false;
  noa.setPaused(false);
}
const dropMeshes = new Map();
function sync(next) {
  if (next.view.revision < snapshot.view.revision) return;
  const changed = next.view.revision !== snapshot.view.revision || JSON.stringify(next.catalog) !== JSON.stringify(snapshot.catalog);
  const old = projection; snapshot = next; projection = projectToNoa(snapshot.view, snapshot.knownAir, old.types); registerPalette();
  const size = snapshot.view.region.size;
  for (let x = 0; x < size.x; x++) for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) {
    const p = { x, y, z }, id = projection.voxel(p); if (id !== old.voxel(p)) noa.setBlock(id, x, y, z);
  }
  for (const [id, mesh] of dropMeshes) if (!snapshot.drops.some(drop => drop.id === id)) { mesh.material?.dispose(); mesh.dispose(); dropMeshes.delete(id); }
  for (const drop of snapshot.drops) if (!dropMeshes.has(drop.id)) {
    const mesh = CreateBox(`drop-${drop.id}`, { size: .25 }, noa.rendering.getScene());
    mesh.position.set(drop.position.x, drop.position.y + .15, drop.position.z);
    mesh.material = noa.rendering.makeStandardMaterial(); mesh.material.diffuseColor = new Color3(.95, .73, .35); dropMeshes.set(drop.id, mesh);
  }
  if (changed) renderInventory();
}
async function command(value, retry = false) {
  if (sending || pending && !retry) throw new Error('Сначала повтори ожидающее действие');
  const p = noa.entities.getPosition(noa.playerEntity);
  const request = retry ? pending : { ...value, actor: value.actor ?? actor(), operationId: value.operationId ?? crypto.randomUUID(),
    playerPosition: value.playerPosition ?? { x: p[0], y: p[1], z: p[2] } };
  sessionStorage.setItem('noa-pending-operation', JSON.stringify(request)); pending = request; sending = true;
  document.querySelector('#retry').hidden = true; renderInventory();
  try {
    const response = await fetch('/probe-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(10000) });
    const next = await response.json();
    if (!response.ok) {
      if (response.status < 500) { pending = null; sessionStorage.removeItem('noa-pending-operation'); }
      throw new Error(next.error);
    }
    pending = null; sessionStorage.removeItem('noa-pending-operation'); sync(next); return next;
  } finally { sending = false; document.querySelector('#retry').hidden = !pending; renderInventory(); }
}
async function mutate(value) {
  try { await command(value); notice('Готово.'); return true; }
  catch (error) { notice(pending ? 'Ответ не получен. Нажми «Повторить действие», чтобы безопасно уточнить результат.' : error.message); return false; }
}
function nearbyDrop() {
  const p = noa.entities.getPosition(noa.playerEntity);
  return snapshot.drops.map(drop => ({ drop, distance: Math.hypot(drop.position.x - p[0], drop.position.y - p[1], drop.position.z - p[2]) }))
    .filter(row => (!row.drop.owner || row.drop.owner === actor()) && row.distance < 2.5).sort((a, b) => a.distance - b.distance)[0]?.drop;
}
async function act() {
  if (sending || pending || ui.dialog.open || !noa.container.hasPointerLock || !noa.targetedBlock) return;
  if (mode === 'build') {
    const [x, y, z] = noa.targetedBlock.adjacent;
    if (noa.entities.isTerrainBlocked(x, y, z)) return notice('Здесь находится персонаж');
    await mutate({ type: 'place', position: { x, y, z }, recipeId: selectedRecipe });
  } else {
    const [x, y, z] = noa.targetedBlock.position; await mutate({ type: 'hit', position: { x, y, z } });
  }
}
async function select(slot) {
  if (slot === 'build') { mode = 'build'; renderInventory(); return; }
  const candidate = items().find(item => definitions().get(item.itemId)?.toolClassId === slot);
  if (!candidate) return notice('В рюкзаке нет такого инструмента');
  if (await mutate({ type: 'select', instanceId: candidate.id })) mode = 'item';
}
for (const button of document.querySelectorAll('[data-slot]')) button.onclick = () => { void select(button.dataset.slot); };
document.querySelector('#open-inventory').onclick = openInventory;
document.querySelector('#actor').onchange = () => { mode = 'item'; renderInventory(); };
document.querySelector('#retry').onclick = async () => { try { await command(null, true); notice('Действие подтверждено.'); } catch (error) { notice(error.message); } };
document.addEventListener('keydown', event => {
  if (event.code === 'Escape') { if (ui.dialog.open) closeInventory(); else noa.container.setPointerLock(false); return; }
  if (event.target.closest('select,button,input,textarea')) return;
  if (event.code === 'KeyI' && !event.repeat) { event.preventDefault(); if (ui.dialog.open) closeInventory(); else openInventory(); return; }
  if (ui.dialog.open || event.repeat) return;
  if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) void select(['pickaxe', 'axe', 'build'][Number(event.code.slice(-1)) - 1]);
  if (event.code === 'KeyE') { const pile = nearbyDrop(); if (pile) void mutate({ type: 'pickup', dropId: pile.id }); }
});
noa.inputs.down.on('alt-fire', () => { if (mode === 'build') void act(); });
noa.on('tick', () => {
  const now = performance.now();
  if (mode === 'item' && noa.inputs.state.fire && now - lastAttempt >= intervalMs + 30) { lastAttempt = now; void act(); }
});
noa.on('afterRender', () => {
  frames++;
  const p = noa.targetedBlock?.position, block = p && snapshot.view.region.blocks.find(block => key(block.position) === p.join(','));
  const type = block && snapshot.view.region.palette.find(type => type.id === block.blockId);
  document.querySelector('#target').textContent = type?.name ?? 'Наведи прицел на объект';
  document.querySelector('#hp').textContent = block ? `HP ${block.hp} / ${block.maxHp}` : '—';
  document.querySelector('#progress').max = block?.maxHp ?? 100; document.querySelector('#progress').value = block?.hp ?? 100;
  const selected = held(), definition = selected && definitions().get(selected.itemId);
  document.querySelector('#held').textContent = `В руке: ${definition?.name ?? 'Ничего'}`;
  document.querySelector('#cargo').textContent = `Рюкзак: ${items().length} / ${snapshot.capacity} мест`;
  const recipe = snapshot.catalog.recipes.find(recipe => recipe.id === selectedRecipe);
  document.querySelector('#blueprint').textContent = mode === 'build' && recipe ? recipe.name : '';
  for (const button of document.querySelectorAll('[data-slot]')) button.setAttribute('aria-pressed', String(button.dataset.slot === 'build' ? mode === 'build' : mode === 'item' && definition?.toolClassId === button.dataset.slot));
  const pile = nearbyDrop(); document.querySelector('#nearby').textContent = pile ? `E · Подобрать: ${definitions().get(pile.itemId)?.name ?? pile.itemId} ×${pile.quantity}` : '';
});
setInterval(async () => {
  if (sending) return;
  try { const response = await fetch('/probe-api', { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error('Сервер недоступен'); sync(await response.json()); }
  catch (error) { notice(error.message); }
}, 500);
document.querySelector('#reset').onclick = async () => { try { await command({ type: 'reset' }); location.reload(); } catch (error) { notice(error.message); } };
document.querySelector('#retry').hidden = !pending;
notice(pending ? 'Есть неподтверждённое действие. Нажми «Повторить действие».' : 'I — рюкзак. Выбери инструмент или чертёж постройки.');
window.probe = { noa, command, snapshot: () => snapshot, stats: () => ({ frames, chunks, dropMeshes: dropMeshes.size }), select, openInventory, closeInventory };
