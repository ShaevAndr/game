import { worldSeed } from './random';
import type { WorldBiome, WorldSettings } from './types';

/** Coherent features in region coordinates. The seed rotates the layout and shifts its contours. */
export function createWorldRelief(seed: number, settings: WorldSettings, biome: WorldBiome) {
  const { regionSize: size, minGroundHeight: min, maxGroundHeight: max } = settings;
  const blocks = biome.relief;
  if (!blocks || Math.min(size.x, size.z) < 24 || max - min < 8) return;

  const orientation = worldSeed(seed, 'relief:orientation') % 8;
  const phase = worldSeed(seed, 'relief:phase') / 0xffffffff * Math.PI * 2;
  const waterLevel = min + 3;
  const lowland = waterLevel + 2;
  const peakRise = max - lowland;
  const hill = (distance: number) => Math.max(0, 1 - distance * distance) ** 2;
  const distance = (u: number, v: number, x: number, z: number, rx: number, rz: number) =>
    Math.hypot((u - x) / rx, (v - z) / rz);

  return (x: number, z: number) => {
    let u = (x + .5) / size.x, v = (z + .5) / size.z;
    if (orientation & 1) u = 1 - u;
    if (orientation & 2) v = 1 - v;
    if (orientation & 4) [u, v] = [v, u];

    const rolling = Math.sin(u * 17 + v * 8 + phase) * Math.cos(v * 15 - phase) * 1.25;
    const summit = hill(distance(u, v, .78, .28, .35, .38));
    const ridge = hill(distance(u, v, .76, .69, .30, .48)) * .78;
    const lake = distance(u, v, .24, .37, .20, .23) + Math.sin(v * 31 + phase) * .08;
    const ravine = Math.abs(v - (.80 + Math.sin(u * 11 + phase) * .055));
    const ravineDepth = 5 * hill(ravine / .105) * hill(Math.abs(u - .30) / .32);

    let height = Math.round(lowland + rolling + peakRise * Math.max(summit, ridge) - ravineDepth);
    const shore = lake < 1.10;
    if (shore) {
      // A graduated shore gives the basin a flat waterline and at most two blocks of water.
      height = lake < .65 ? waterLevel - 2 : lake < .90 ? waterLevel - 1 : lake < 1 ? waterLevel : waterLevel + 1;
    }
    height = Math.max(min, Math.min(max, height));
    const alpine = height >= max - 2;
    const rocky = height >= lowland + Math.ceil(peakRise * .45);
    const scree = ravineDepth >= 1.5;
    const surface = shore ? (lake < .65 || Math.sin(v * 43 + phase) > .4 ? blocks.clayBlockId : blocks.sandBlockId)
      : alpine ? blocks.snowBlockId : rocky ? blocks.graniteBlockId : scree ? blocks.screeBlockId : biome.surfaceBlockId;
    const soil = shore ? blocks.clayBlockId : rocky ? blocks.graniteBlockId : biome.soilBlockId;
    const stone = rocky ? blocks.graniteBlockId : biome.stoneBlockId;
    const trees = shore || rocky || scree ? 0 : 1 + .7 * Math.sin(u * 18 - v * 12 + phase) * Math.cos(v * 17);
    return { height, surface, soil, stone, trees, waterLevel: shore ? waterLevel : 0 };
  };
}
