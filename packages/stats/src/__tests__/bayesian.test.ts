import { describe, expect, it } from "vitest";
import { analyzeBinaryMetric } from "../bayesian/bayesian-binary.js";
import { analyzeContinuousMetric, bootstrapRelativeLiftCI, winsorize } from "../bayesian/bayesian-bootstrap.js";
import { createRng } from "../math/random.js";

/** Deterministic spread-out sample around `mean` (uniform noise), for fixtures. */
function sample(n: number, mean: number, spread: number, seed: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => mean + (rng() - 0.5) * 2 * spread);
}

describe("analyzeBinaryMetric", () => {
  it("gives ~50/50 pBest for two identical, well-sampled variants", () => {
    const r = analyzeBinaryMetric(
      [
        { key: "a", successes: 500, trials: 1000 },
        { key: "b", successes: 500, trials: 1000 },
      ],
      { rng: createRng(1) },
    );
    expect(r[0].pBest).toBeCloseTo(0.5, 1);
    expect(r[1].pBest).toBeCloseTo(0.5, 1);
  });
  it("strongly favors a clearly better variant", () => {
    const r = analyzeBinaryMetric(
      [
        { key: "a", successes: 100, trials: 1000 },
        { key: "b", successes: 200, trials: 1000 },
      ],
      { rng: createRng(2) },
    );
    const b = r.find((x) => x.key === "b")!;
    expect(b.pBest).toBeGreaterThan(0.99);
    expect(b.expectedLoss).toBeLessThan(0.005);
  });
  it("the worse variant carries more expected loss", () => {
    const r = analyzeBinaryMetric(
      [
        { key: "a", successes: 50, trials: 1000 },
        { key: "b", successes: 150, trials: 1000 },
      ],
      { rng: createRng(3) },
    );
    expect(r.find((x) => x.key === "b")!.expectedLoss).toBeLessThan(r.find((x) => x.key === "a")!.expectedLoss);
  });
  it("stays uncertain with tiny samples", () => {
    const r = analyzeBinaryMetric(
      [
        { key: "a", successes: 1, trials: 5 },
        { key: "b", successes: 3, trials: 5 },
      ],
      { rng: createRng(4) },
    );
    expect(r.find((x) => x.key === "b")!.pBest).toBeLessThan(0.95);
  });
  it("supports A/B/n: pBest sums to ~1 and intervals bracket the rate", () => {
    const r = analyzeBinaryMetric(
      [
        { key: "a", successes: 100, trials: 1000 },
        { key: "b", successes: 110, trials: 1000 },
        { key: "c", successes: 90, trials: 1000 },
      ],
      { rng: createRng(5) },
    );
    expect(r.reduce((s, x) => s + x.pBest, 0)).toBeCloseTo(1, 1);
    for (const x of r) {
      expect(x.credibleInterval[0]).toBeLessThanOrEqual(x.rate);
      expect(x.credibleInterval[1]).toBeGreaterThanOrEqual(x.rate);
    }
  });
  it("throws with fewer than 2 variants", () => {
    expect(() => analyzeBinaryMetric([{ key: "a", successes: 1, trials: 10 }])).toThrow(RangeError);
  });
});

describe("analyzeContinuousMetric", () => {
  it("gives ~50/50 pBest when both variants hold exactly the same values", () => {
    const a = sample(400, 50, 10, 10);
    const b = [...a].reverse(); // identical distribution, identical mean
    const r = analyzeContinuousMetric(
      [
        { key: "a", values: a },
        { key: "b", values: b },
      ],
      { rng: createRng(100) },
    );
    expect(r[0].pBest).toBeGreaterThan(0.35);
    expect(r[0].pBest).toBeLessThan(0.65);
  });
  it("strongly favors a clearly higher mean", () => {
    const r = analyzeContinuousMetric(
      [
        { key: "a", values: sample(300, 40, 8, 20) },
        { key: "b", values: sample(300, 60, 8, 21) },
      ],
      { rng: createRng(101) },
    );
    const b = r.find((x) => x.key === "b")!;
    expect(b.pBest).toBeGreaterThan(0.99);
    expect(b.mean).toBeGreaterThan(r.find((x) => x.key === "a")!.mean);
  });
  it("winsorize caps a runaway outlier once there is enough data for a stable percentile", () => {
    const clean = sample(100, 10, 2, 30);
    const withOutlier = [...clean.slice(0, 99), 100000];
    const capped = winsorize(withOutlier);
    expect(Math.max(...capped)).toBeLessThan(100);
    const r = analyzeContinuousMetric(
      [
        { key: "outlier", values: withOutlier },
        { key: "clean", values: clean },
      ],
      { rng: createRng(102) },
    );
    expect(r.find((x) => x.key === "outlier")!.mean).toBeLessThan(20);
  });
  it("supports the log transform for skewed positive metrics", () => {
    const r = analyzeContinuousMetric(
      [
        { key: "a", values: [5, 8, 6, 7, 9, 6, 8, 7] },
        { key: "b", values: [15, 18, 16, 17, 19, 16, 18, 17] },
      ],
      { rng: createRng(103), transform: "log" },
    );
    expect(r.find((x) => x.key === "b")!.mean).toBeGreaterThan(r.find((x) => x.key === "a")!.mean);
  });
  it("throws with too few variants or observations", () => {
    expect(() => analyzeContinuousMetric([{ key: "a", values: [1, 2, 3] }])).toThrow(RangeError);
    expect(() =>
      analyzeContinuousMetric([
        { key: "a", values: [1] },
        { key: "b", values: [1, 2, 3] },
      ]),
    ).toThrow(RangeError);
  });
});

describe("bootstrapRelativeLiftCI", () => {
  it("brackets a known ~20% lift with margin", () => {
    const [lo, hi] = bootstrapRelativeLiftCI(sample(400, 50, 5, 200), sample(400, 60, 5, 201), { rng: createRng(200) });
    expect(lo).toBeLessThan(0.23);
    expect(hi).toBeGreaterThan(0.17);
  });
  it("excludes 0 for a large lift with big samples", () => {
    const [lo] = bootstrapRelativeLiftCI(sample(500, 50, 3, 300), sample(500, 70, 3, 301), { rng: createRng(201) });
    expect(lo).toBeGreaterThan(0);
  });
});
