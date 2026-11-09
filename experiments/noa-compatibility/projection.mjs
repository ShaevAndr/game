export const key = p => `${p.x},${p.y},${p.z}`;
export const intervalMs = 250;

export function projectToNoa(view, knownAir, existingTypes) {
  const { region } = view;
  const types = new Map(existingTypes);
  for (const block of region.palette) if (!types.has(block.id)) types.set(block.id, types.size + 2);
  const solids = new Map(region.blocks.map(block => [key(block.position), types.get(block.blockId)]));
  const inside = p => ['x', 'y', 'z'].every(axis => Number.isInteger(p[axis]) && p[axis] >= 0 && p[axis] < region.size[axis]);
  const air = new Set(knownAir), queue = [{ ...view.location.position }];
  // Only connected air is known to be empty. Omitted buried voxels stay solid/unknown.
  if (!inside(queue[0]) || solids.has(key(queue[0]))) throw new Error('Invalid public spawn');
  air.add(key(queue[0]));
  for (let i = 0; !knownAir && i < queue.length; i++) for (const axis of ['x', 'y', 'z']) for (const step of [-1, 1]) {
    const p = { ...queue[i], [axis]: queue[i][axis] + step }, id = key(p);
    if (inside(p) && !solids.has(id) && !air.has(id)) { air.add(id); queue.push(p); }
  }
  return { types, inside, air, voxel: p => solids.get(key(p)) ?? (air.has(key(p)) ? 0 : 1) };
}

