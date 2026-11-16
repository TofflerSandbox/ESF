/* Shared helpers for the synthetic data generators. */
export const DAY = 864e5;
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const add = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Deterministic RNG, one stream per key, so a project's draw doesn't depend on the others. */
export function rngFor(seed: number, key: string) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const c of key) { h = Math.imul(h ^ c.charCodeAt(0), 0x5bd1e995); h ^= h >>> 13; }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    /** weighted pick; returns the index */
    weighted: (ws: number[]) => { const t = ws.reduce((a, b) => a + b, 0); let x = next() * t; for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return i; } return ws.length - 1; },
  };
}
export type R = ReturnType<typeof rngFor>;
