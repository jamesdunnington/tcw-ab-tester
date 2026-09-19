import { describe, expect, it } from "vitest";
import { welchTTest } from "../frequentist/welch-t.js";
import { mannWhitneyU } from "../frequentist/mann-whitney.js";
import { chiSquareSrmCheck } from "../frequentist/chi-square-srm.js";
import { holmBonferroniCorrection } from "../frequentist/holm-bonferroni.js";

describe("welchTTest", () => {
  it("identical samples: t=0, p=1", () => {
    const s = [10, 12, 11, 13, 9, 10, 14, 12];
    const r = welchTTest(s, [...s]);
    expect(r.t).toBeCloseTo(0, 6);
    expect(r.p).toBeCloseTo(1, 6);
  });
  it("large consistent gap is significant with ~2x lift", () => {
    const r = welchTTest([10, 11, 9, 10, 12, 9, 11, 10, 10, 11], [20, 21, 19, 20, 22, 19, 21, 20, 20, 21]);
    expect(r.p).toBeLessThan(0.001);
    expect(r.relativeLift).toBeCloseTo(1.0, 1);
  });
  it("does not assume equal variance", () => {
    const r = welchTTest([50, 50, 51, 49, 50, 50, 51, 49, 50, 50], [30, 70, 40, 60, 20, 80, 35, 65, 45, 55]);
    expect(r.p).toBeGreaterThan(0.05);
  });
  it("throws with fewer than 2 observations", () => {
    expect(() => welchTTest([1], [1, 2, 3])).toThrow(RangeError);
  });
});

describe("mannWhitneyU", () => {
  it("identical samples are not significant", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(mannWhitneyU(s, [...s]).p).toBeGreaterThan(0.5);
  });
  it("fully separated samples are significant", () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(r.p).toBeLessThan(0.001);
  });
  it("all-tied samples stay within [0,1]", () => {
    const r = mannWhitneyU([5, 5, 5, 5, 5], [5, 5, 5, 5, 5]);
    expect(r.p).toBeGreaterThanOrEqual(0);
    expect(r.p).toBeLessThanOrEqual(1);
  });
});

describe("chiSquareSrmCheck", () => {
  it("passes a matching 50/50 split", () => {
    expect(chiSquareSrmCheck([5000, 5010], [50, 50]).isMismatched).toBe(false);
  });
  it("flags a heavily skewed split", () => {
    const r = chiSquareSrmCheck([7000, 3000], [50, 50]);
    expect(r.isMismatched).toBe(true);
    expect(r.p).toBeLessThan(0.001);
  });
  it("respects unequal weights and supports A/B/n", () => {
    expect(chiSquareSrmCheck([7010, 2990], [70, 30]).isMismatched).toBe(false);
    expect(chiSquareSrmCheck([3340, 3330, 3330], [33.3, 33.3, 33.3]).df).toBe(2);
  });
  it("throws on bad input", () => {
    expect(() => chiSquareSrmCheck([100], [50])).toThrow(RangeError);
    expect(() => chiSquareSrmCheck([100, 100], [50])).toThrow(RangeError);
  });
});

describe("holmBonferroniCorrection", () => {
  it("handles empty and single inputs", () => {
    expect(holmBonferroniCorrection([])).toEqual([]);
    expect(holmBonferroniCorrection([0.03])).toEqual([0.03]);
  });
  it("matches the textbook example 0.01/0.02/0.03 -> 0.03/0.04/0.04", () => {
    const a = holmBonferroniCorrection([0.01, 0.02, 0.03]);
    expect(a[0]).toBeCloseTo(0.03, 6);
    expect(a[1]).toBeCloseTo(0.04, 6);
    expect(a[2]).toBeCloseTo(0.04, 6);
  });
  it("preserves input order, caps at 1, and is monotonic in rank", () => {
    const adj = holmBonferroniCorrection([0.03, 0.01, 0.02]);
    expect(adj[1]).toBeLessThan(adj[0]);
    expect(holmBonferroniCorrection([0.5, 0.6, 0.7, 0.9]).every((p) => p <= 1)).toBe(true);
    const raw = [0.001, 0.2, 0.15, 0.04, 0.5];
    const out = holmBonferroniCorrection(raw);
    const sorted = raw.map((p, i) => ({ p, a: out[i] })).sort((x, y) => x.p - y.p);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].a).toBeGreaterThanOrEqual(sorted[i - 1].a);
  });
});
