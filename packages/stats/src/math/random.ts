/**
 * Seeded PRNG plus the samplers the Monte Carlo methods need. Deterministic
 * so tests are reproducible; Monte Carlo stability depends on draw count,
 * not on true randomness.
 */

export type Rng = () => number;

/** mulberry32: fast, small, good-enough statistical quality (not cryptographic). */
export function createRng(seed = 0xc0ffee): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box-Muller. */
export function sampleStandardNormal(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Gamma(shape, 1) via Marsaglia & Tsang (2000). Requires shape >= 1, which
 * holds at every call site (Beta-posterior shapes are `1 + count`).
 */
export function sampleGamma(rng: Rng, shape: number): number {
  if (shape < 1) throw new RangeError(`sampleGamma: shape must be >= 1, got ${shape}`);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) via two Gamma draws (shapes must be >= 1). */
export function sampleBeta(rng: Rng, a: number, b: number): number {
  const x = sampleGamma(rng, a);
  const y = sampleGamma(rng, b);
  return x / (x + y);
}

/**
 * One Dirichlet(1,...,1) draw (Rubin's Bayesian-bootstrap weights). Closed
 * form: normalize n i.i.d. Exponential(1) draws.
 */
export function sampleDirichletUniformWeights(rng: Rng, n: number): number[] {
  const exps = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = -Math.log(1 - rng());
    exps[i] = e;
    sum += e;
  }
  return exps.map((e) => e / sum);
}
