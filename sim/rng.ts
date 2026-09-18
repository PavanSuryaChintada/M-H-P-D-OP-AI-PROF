// Doc 04 deliverable: "seeded, deterministic generator (fixed RNG seed so
// the demo is reproducible)". mulberry32 — small, dependency-free, good
// enough statistical quality for generating demo data (not for anything
// cryptographic).

export function createRng(seed: number) {
  let state = seed >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** [0, 1) */
    float: next,
    /** integer in [min, max] inclusive */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** true with probability p (0-1) */
    chance(p: number): boolean {
      return next() < p;
    },
    /** weighted pick — weights need not sum to 1 */
    pick<T>(items: readonly T[], weights?: readonly number[]): T {
      if (!weights) return items[Math.floor(next() * items.length)];
      const total = weights.reduce((a, b) => a + b, 0);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
