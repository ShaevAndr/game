// Run in the existing world container; exports only the public WorldView projection.
const { createVoxelWorld, applyWorldCommand, initialWorldCatalog, defaultWorldSettings, seedContent, writeWorldBlock, worldView } = require('@game/core');
const actor = { playerId: 'probe', characterId: 'probe', partyId: 'probe', membershipId: 'probe', isLeader: true };
const settings = { ...defaultWorldSettings, regionSize: { x: 13, y: 12, z: 11 }, minGroundHeight: 3, maxGroundHeight: 3, treeChanceBps: 0 };
let world = createVoxelWorld({ id: 'probe', partyId: 'probe', seed: 17, catalog: initialWorldCatalog, settings, items: seedContent.items, gatherers: [{ playerId: 'probe', characterId: 'probe', xp: 0 }] });
world = applyWorldCommand(world, { operationId: '00000000-0000-4000-8000-000000000001', expectedRevision: 0, action: { type: 'enter' } }, actor).state;
const p = world.location.position;
for (const [dx, type] of [[0, 'stone'], [3, 'oak-trunk'], [-3, 'soil']])
  for (const dy of [0, 1]) writeWorldBlock(world.regions[0], { x: p.x + dx, y: p.y + dy, z: p.z + 3 }, type);
console.log(JSON.stringify(worldView(world, actor)));
