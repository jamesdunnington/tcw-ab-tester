import { describe, expect, it } from "vitest";
import { normalCdf, normalQuantile } from "../math/normal.js";
import { regularizedIncompleteBeta } from "../math/incomplete-beta.js";
import { regularizedLowerIncompleteGamma } from "../math/incomplete-gamma.js";
import { createRng, sampleBeta, sampleDirichletUniformWeights, sampleGamma, sampleStandardNormal } from "../math/random.js";

const twoTailedTP = (t: number, df: number) => regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5);
const chiSquareCdf = (x: number, k: number) => regularizedLowerIncompleteGamma(k / 2, x / 2);

describe("normal", () => {
  it("CDF matches textbook z values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959963985)).toBeCloseTo(0.025, 4);
    expect(normalCdf(2.326347874)).toBeCloseTo(0.99, 4);
  });
  it("quantile inverts the CDF", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 5);
    expect(normalQuantile(0.95)).toBeCloseTo(1.644853627, 5);
    for (const x of [-2.5, -1, -0.3, 0.1, 0.9, 2.1]) expect(normalQuantile(normalCdf(x))).toBeCloseTo(x, 4);
  });
});

describe("incomplete beta (via t-distribution critical values)", () => {
  it("I_x(1,1) = x and symmetry holds", () => {
    for (const x of [0.1, 0.5, 0.9]) expect(regularizedIncompleteBeta(x, 1, 1)).toBeCloseTo(x, 8);
    expect(regularizedIncompleteBeta(0.3, 2, 5)).toBeCloseTo(1 - regularizedIncompleteBeta(0.7, 5, 2), 8);
  });
  it("matches textbook two-tailed 0.05 critical values", () => {
    expect(twoTailedTP(2.228, 10)).toBeCloseTo(0.05, 2);
    expect(twoTailedTP(2.042, 30)).toBeCloseTo(0.05, 2);
    expect(twoTailedTP(12.706, 1)).toBeCloseTo(0.05, 2);
    expect(twoTailedTP(1.96, 100000)).toBeCloseTo(0.05, 2);
    expect(twoTailedTP(0, 10)).toBeCloseTo(1, 6);
  });
});

describe("incomplete gamma (via chi-square critical values)", () => {
  it("matches textbook chi-square percentiles", () => {
    expect(chiSquareCdf(3.841459, 1)).toBeCloseTo(0.95, 3);
    expect(chiSquareCdf(5.991465, 2)).toBeCloseTo(0.95, 3);
    expect(chiSquareCdf(10.828, 1)).toBeCloseTo(0.999, 3);
    expect(chiSquareCdf(15.086, 5)).toBeCloseTo(0.99, 3);
    expect(chiSquareCdf(0, 3)).toBe(0);
  });
});

describe("random samplers", () => {
  it("createRng is deterministic and in [0,1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a())).toEqual(Array.from({ length: 5 }, () => b()));
    const r = createRng(1);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("normal has mean ~0 and variance ~1", () => {
    const rng = createRng(7);
    let s = 0;
    let ss = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = sampleStandardNormal(rng);
      s += x;
      ss += x * x;
    }
    expect(s / n).toBeCloseTo(0, 1);
    expect(ss / n - (s / n) ** 2).toBeCloseTo(1, 1);
  });
  it("gamma and beta match their theoretical means", () => {
    const rng = createRng(3);
    let g = 0;
    let b = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      g += sampleGamma(rng, 4);
      b += sampleBeta(rng, 3, 7);
    }
    expect(g / n).toBeCloseTo(4, 0);
    expect(b / n).toBeCloseTo(0.3, 1);
    expect(() => sampleGamma(rng, 0.5)).toThrow(RangeError);
  });
  it("Dirichlet weights are non-negative and sum to 1", () => {
    const rng = createRng(9);
    for (let i = 0; i < 100; i++) {
      const w = sampleDirichletUniformWeights(rng, 5);
      expect(w.every((x) => x >= 0)).toBe(true);
      expect(w.reduce((a, c) => a + c, 0)).toBeCloseTo(1, 8);
    }
  });
});
