import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import catalog from './catalog.json' with { type: 'json' };
import { createProbe, validateCatalog, projectToNoa, intervalMs, key, capacity } from './probe.mjs';
const fixture = JSON.parse(readFileSync(new URL('./world-view.json', import.meta.url)));
const spawn = fixture.location.position, target = { x: spawn.x, y: spawn.y + 1, z: spawn.z + 3 };
const hp = probe => probe.snapshot().view.region.blocks.find(block => key(block.position) === key(target))?.hp;
const quantity = (probe, itemId, actor = 'strong') => probe.snapshot().inventory[actor].filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0);
const item = (probe, itemId, actor = 'strong') => probe.snapshot().inventory[actor].find(item => item.itemId === itemId);
const error = code => value => value.code === code;
function setup(options = {}) {
  let now = 0, counter = 0; const probe = createProbe(fixture, { clock: () => now, ...options });
  const command = (body, actor = 'strong') => probe.execute({ actor, operationId: `command-${counter++}`, ...body });
  const hit = (position = target, actor = 'strong') => { const result = command({ type: 'hit', position }, actor); now += intervalMs; return result; };
  const mine = (actor = 'strong', position = target) => { for (let i = 0; i < (actor === 'strong' ? 4 : 10); i++) hit(position, actor); };
  return { probe, command, hit, mine, advance: () => { now += intervalMs; } };
}

test('public geometry preserves irregular dimensions, unknown solidity and stable type IDs', () => {
  const p = projectToNoa(fixture);
  assert.equal(p.voxel(spawn), 0); assert.equal(p.voxel(target), p.types.get('stone'));
  assert.equal(p.voxel({ x: 0, y: 0, z: 0 }), 1); assert.equal(p.voxel({ x: 13, y: 3, z: 5 }), 1);
  const reordered = structuredClone(fixture); reordered.region.palette.reverse();
  assert.deepEqual(projectToNoa(reordered, undefined, p.types).types, p.types);
});

test('100 HP needs ten strength-10 hits or four strength-25 hits, with loot only at zero HP', () => {
  for (const [actor, count] of [['weak', 10], ['strong', 4]]) {
    const f = setup();
    for (let i = 0; i < count; i++) { f.hit(target, actor); if (i < count - 1) { assert.ok(hp(f.probe) > 0); assert.equal(f.probe.snapshot().drops.length, 0); } }
    assert.equal(hp(f.probe), undefined); assert.ok(f.probe.snapshot().drops.length >= 1);
    assert.ok(f.probe.snapshot().drops.every(drop => drop.itemId !== 'stone'));
  }
});

test('weapons and tools are actual inventory selections; spoofed tool and damage are ignored', () => {
  const f = setup(); f.command({ type: 'select', instanceId: item(f.probe, 'iron-sword').id });
  assert.throws(() => f.command({ type: 'hit', position: target, tool: 'pickaxe', damage: 10000 }), error('WRONG_TOOL'));
  f.command({ type: 'select', instanceId: item(f.probe, 'mining-pick').id });
  f.command({ type: 'hit', position: target, damage: 10000 }); assert.equal(hp(f.probe), 75);
  assert.throws(() => f.command({ type: 'select', instanceId: item(f.probe, 'mining-pick', 'weak').id }), error('SELECTION'));
});

test('shared HP, cooldown and durable operation IDs prevent double damage and rerolled loot', () => {
  const f = setup(), hit = { type: 'hit', actor: 'strong', operationId: 'same', position: target };
  f.probe.execute(hit); f.probe.execute(hit); assert.equal(hp(f.probe), 75);
  assert.throws(() => f.probe.execute({ ...hit, position: spawn }), error('OPERATION_CONFLICT'));
  assert.throws(() => f.command({ type: 'hit', position: target }), error('COOLDOWN'));
  f.hit(target, 'weak'); assert.equal(hp(f.probe), 65);
  f.advance(); for (let i = 0; i < 3; i++) f.hit();
  const before = f.probe.exportState(), restored = createProbe(fixture, { state: before });
  restored.execute(hit); assert.deepEqual(restored.exportState(), before);
});

test('per-object database rows control independent drops, quantities, zero chances and empty yield', () => {
  const custom = structuredClone(catalog), stone = custom.items.find(item => item.id === 'stone').worldObject;
  stone.drops = [ { itemId: 'stone-piece', min: 2, max: 2, chanceBps: 10000 }, { itemId: 'gold-ore', min: 1, max: 1, chanceBps: 10000 }, { itemId: 'moon-stone', min: 1, max: 1, chanceBps: 0 } ];
  const f = setup({ catalog: custom }); f.mine();
  assert.deepEqual(f.probe.snapshot().drops.map(drop => [drop.itemId, drop.quantity]), [['stone-piece', 2], ['gold-ore', 1]]);
  stone.drops = []; const empty = setup({ catalog: custom }); empty.mine(); assert.equal(empty.probe.snapshot().drops.length, 0); assert.equal(hp(empty.probe), undefined);
  stone.drops = [{ itemId: 'unknown', min: 1, max: 1, chanceBps: 10000 }]; assert.throws(() => validateCatalog(custom), error('CATALOG'));
});

test('the seeded random stream persists across restoration without disclosing drop tables or RNG', () => {
  const f = setup(); f.mine(); const restored = createProbe(fixture, { state: f.probe.exportState() });
  assert.deepEqual(restored.exportState().rng, f.probe.exportState().rng);
  const publicData = restored.snapshot();
  assert.equal('rng' in publicData, false); assert.equal(JSON.stringify(publicData.catalog).includes('chanceBps'), false);
  assert.equal('seed' in publicData.view, false); assert.equal('chunks' in publicData.view.region, false);
});

test('partial stack drop and cross-player pickup conserve quantity and survive retries', () => {
  const f = setup(), instanceId = item(f.probe, 'stone-piece').id;
  const drop = { type: 'drop', actor: 'strong', operationId: 'drop-seven', instanceId, quantity: 7 };
  f.probe.execute(drop); f.probe.execute(drop); assert.equal(quantity(f.probe, 'stone-piece'), 73);
  const pile = f.probe.snapshot().drops[0]; assert.equal(pile.quantity, 7); assert.equal(pile.owner, null);
  const pickup = { type: 'pickup', actor: 'weak', operationId: 'pickup-seven', dropId: pile.id };
  f.probe.execute(pickup); f.probe.execute(pickup); assert.equal(quantity(f.probe, 'stone-piece', 'weak'), 87);
  assert.equal(f.probe.snapshot().drops.length, 0);
  assert.throws(() => f.command({ type: 'pickup', dropId: pile.id }), error('DROP_UNAVAILABLE'));
});

test('invalid, fractional, excessive and foreign-instance drops leave all state unchanged', () => {
  const f = setup(), instanceId = item(f.probe, 'stone-piece').id, before = f.probe.exportState();
  for (const quantity of [-1, 0, 1.5, 81, NaN]) assert.throws(() => f.command({ type: 'drop', instanceId, quantity }), error('QUANTITY'));
  assert.throws(() => f.command({ type: 'drop', instanceId: item(f.probe, 'stone-piece', 'weak').id, quantity: 1 }), error('QUANTITY'));
  assert.deepEqual(f.probe.exportState(), before);
});

test('dropping the selected weapon clears the hand; picking it up does not silently select it', () => {
  const f = setup(), sword = item(f.probe, 'iron-sword'); f.command({ type: 'select', instanceId: sword.id });
  f.command({ type: 'drop', instanceId: sword.id, quantity: 1 }); assert.equal(f.probe.snapshot().selectedItems.strong, null);
  f.command({ type: 'pickup', dropId: f.probe.snapshot().drops[0].id }); assert.equal(f.probe.snapshot().selectedItems.strong, null);
  assert.equal(quantity(f.probe, 'iron-sword'), 1);
});

test('full inventory cannot consume any part of a world pile', () => {
  const seed = setup().probe.exportState();
  seed.inventory.strong = Array.from({ length: capacity }, (_, i) => ({ id: `sword-${i}`, itemId: 'iron-sword', quantity: 1 }));
  seed.selectedItems.strong = 'sword-0'; seed.drops.push({ id: 'pile', itemId: 'gold-ore', quantity: 1, owner: 'strong', position: seed.positions.strong });
  const f = setup({ state: seed }), before = f.probe.exportState();
  assert.throws(() => f.command({ type: 'pickup', dropId: 'pile' }), error('INVENTORY_FULL')); assert.deepEqual(f.probe.exportState(), before);
});

test('placement spends 40 stones across stacks and one resin atomically and only once', () => {
  const state = setup().probe.exportState(), stack = state.inventory.strong.find(item => item.itemId === 'stone-piece');
  stack.quantity = 20; state.inventory.strong.push({ ...stack, id: 'second-stone-stack', quantity: 60 });
  const f = setup({ state }), p = { x: 7, y: 3, z: 6 };
  const placement = { type: 'place', actor: 'strong', operationId: 'place-one', recipeId: 'place-masonry', position: p };
  f.probe.execute(placement); f.probe.execute(placement);
  assert.equal(quantity(f.probe, 'stone-piece'), 40); assert.equal(quantity(f.probe, 'tree-resin'), 9);
  const block = f.probe.snapshot().view.region.blocks.find(block => key(block.position) === key(p));
  assert.equal(block.blockId, 'masonry'); assert.equal(block.hp, 150);
});

test('missing ingredients, occupied targets and forged block IDs cannot spend materials or place free blocks', () => {
  const f = setup(), before = f.probe.exportState();
  for (const position of [spawn, { x: 6, y: 3, z: 5 }, { x: -1, y: 3, z: 6 }, { x: 7.5, y: 3, z: 6 }, target])
    assert.throws(() => f.command({ type: 'place', recipeId: 'place-masonry', position }));
  assert.throws(() => f.command({ type: 'place', blockId: 'stone', position: { x: 7, y: 3, z: 6 } }), error('PLACEMENT'));
  assert.deepEqual(f.probe.exportState(), before);
  const state = f.probe.exportState(); state.inventory.strong = state.inventory.strong.filter(item => item.itemId !== 'tree-resin');
  const withoutResin = setup({ state }), original = withoutResin.probe.exportState();
  assert.throws(() => withoutResin.command({ type: 'place', recipeId: 'place-masonry', position: { x: 7, y: 3, z: 6 } }), error('INGREDIENTS'));
  assert.deepEqual(withoutResin.probe.exportState(), original);
});

test('excavating a surface reveals only that voxel, including for a late client', () => {
  const f = setup(), floor = { ...spawn, y: spawn.y - 1 }; f.mine('strong', floor);
  const saved = f.probe.snapshot(), projection = projectToNoa(saved.view, saved.knownAir);
  assert.equal(projection.voxel(floor), 0); assert.equal(projection.voxel({ ...floor, y: floor.y - 1 }), 1);
});

test('startup resin supply gives both existing actors ten once and never refills on browser reload', () => {
  const old = setup().probe.exportState();
  for (const inventory of Object.values(old.inventory)) inventory.find(item => item.itemId === 'tree-resin').quantity = 3;
  const f = setup({ state: old });
  f.probe.ensureStartingSupply('tree-resin', 10, 'starter-resin');
  assert.equal(quantity(f.probe, 'tree-resin'), 10); assert.equal(quantity(f.probe, 'tree-resin', 'weak'), 10);
  f.command({ type: 'drop', instanceId: item(f.probe, 'tree-resin').id, quantity: 2 });
  const restored = createProbe(fixture, { state: f.probe.exportState() });
  restored.ensureStartingSupply('tree-resin', 10, 'starter-resin');
  assert.equal(quantity(restored, 'tree-resin'), 8);
});

test('deleting a definition used by saved terrain fails closed instead of making the block disappear', () => {
  const saved = setup().probe.exportState(), edited = structuredClone(catalog);
  edited.items = edited.items.filter(item => item.id !== 'stone');
  assert.throws(() => createProbe(fixture, { state: saved, catalog: edited }), error('CATALOG'));
});

test('construction preserves a clear entry point even after both actors walk away', () => {
  const state = setup().probe.exportState(); state.positions.strong = { x: 8.5, y: 3, z: 6.5 }; state.positions.weak = { x: 9.5, y: 3, z: 6.5 };
  const f = setup({ state }), before = f.probe.exportState();
  assert.throws(() => f.command({ type: 'place', recipeId: 'place-masonry', position: spawn }), error('OCCUPIED'));
  assert.deepEqual(f.probe.exportState(), before);
});
