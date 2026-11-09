/** Stable seed derivation. Generation never consumes the saved harvesting stream. */
export function worldSeed(seed: number, key: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}
export function nextWorldRandom(state: number): { state: number; bps: number } {
  const next = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: next, bps: Math.floor(next / 4294967296 * 10000) };
}
