import { describe, expect, it } from "vitest";
import { computeEngagementScore, ENGAGEMENT_PRESETS, expectedReadMs } from "../engagement-score.js";
import { sampleSizeForMeans, sampleSizeForProportions } from "../sample-size.js";
import { decideWinner, type DecisionConfig, type VariantData } from "../winner-decision.js";
import { createRng } from "../math/random.js";

function sample(n: number, mean: number, spread: number, seed: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => mean + (rng() - 0.5) * 2 * spread);
}

describe("engagement score", () => {
  it("presets each sum to exactly 100", () => {
    for (const w of Object.values(ENGAGEMENT_PRESETS)) {
      expect(w.activeTime + w.scrollDepth + w.hover + w.click).toBe(100);
    }
  });
  it("a quick bounce scores 0", () => {
    const s = { activeMs: 2000, maxScrollPct: 0, hovered: false, clicked: false, rageClicks: 0 };
    expect(computeEngagementScore(s, ENGAGEMENT_PRESETS.content, 800)).toBe(0);
  });
  it("a full read + full scroll + click scores 100 on the CTA preset", () => {
    const s = { activeMs: 10 * 60_000, maxScrollPct: 100, hovered: true, clicked: true, rageClicks: 0 };
    expect(computeEngagementScore(s, ENGAGEMENT_PRESETS.cta, 500)).toBe(100);
  });
  it("rage clicks subtract 5 points each and the score never goes below 0", () => {
    const base = { activeMs: 10 * 60_000, maxScrollPct: 100, hovered: true, clicked: true, rageClicks: 0 };
    const clean = computeEngagementScore(base, ENGAGEMENT_PRESETS.cta, 500);
    expect(computeEngagementScore({ ...base, rageClicks: 2 }, ENGAGEMENT_PRESETS.cta, 500)).toBe(clean - 10);
    expect(computeEngagementScore({ ...base, activeMs: 6000, maxScrollPct: 1, hovered: false, clicked: false, rageClicks: 50 }, ENGAGEMENT_PRESETS.cta, 500)).toBe(0);
  });
  it("expected read time scales with word count, floored at 10s", () => {
    expect(expectedReadMs(10)).toBe(10_000);
    expect(expectedReadMs(2300)).toBeCloseTo(600_000, 0);
  });
});

describe("sample size calculators", () => {
  it("5% baseline, +20% relative MDE needs roughly 8,000 per arm", () => {
    const n = sampleSizeForProportions(0.05, 0.2);
    expect(n).toBeGreaterThan(7500);
    expect(n).toBeLessThan(8800);
  });
  it("means: sd 10, detect 2 points -> 393 per arm", () => {
    expect(sampleSizeForMeans(10, 2)).toBe(393);
  });
  it("smaller effects need more data", () => {
    expect(sampleSizeForProportions(0.05, 0.1)).toBeGreaterThan(sampleSizeForProportions(0.05, 0.2));
  });
  it("rejects invalid inputs", () => {
    expect(() => sampleSizeForProportions(0, 0.2)).toThrow(RangeError);
    expect(() => sampleSizeForMeans(0, 1)).toThrow(RangeError);
  });
});

describe("decideWinner", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const cfg = (daysElapsed: number, over: Partial<DecisionConfig> = {}): DecisionConfig => ({
    minSampleSize: 200,
    minRunDays: 7,
    confidenceThreshold: 0.95,
    startedAt: start,
    now: new Date(start.getTime() + daysElapsed * 86_400_000),
    ...over,
  });
  const arm = (key: string, isControl: boolean, mean: number, seed: number, n = 400): VariantData => ({
    key, isControl, weight: 50, sessions: n, clicks: Math.round(n * 0.1), scores: sample(n, mean, 8, seed),
  });

  it("declares the better variant the winner once every gate passes", () => {
    const d = decideWinner([arm("a", true, 40, 1), arm("b", false, 60, 2)], cfg(10), createRng(1));
    expect(d.status).toBe("winner_found");
    expect(d.winnerKey).toBe("b");
    expect(d.gates.every((g) => g.passed)).toBe(true);
    expect(d.variants[1].lift?.estimate).toBeGreaterThan(0.3);
    expect(d.variants[1].confirmation?.adjustedWelchP).toBeLessThan(0.001);
  });
  it("does not call a winner before the minimum run time, even with a huge gap", () => {
    const d = decideWinner([arm("a", true, 40, 1), arm("b", false, 60, 2)], cfg(2), createRng(1));
    expect(d.status).toBe("running");
    expect(d.gates.find((g) => g.name === "Minimum run time")?.passed).toBe(false);
  });
  it("does not call a winner below the minimum sample size", () => {
    const d = decideWinner([arm("a", true, 40, 1, 50), arm("b", false, 60, 2, 50)], cfg(10), createRng(1));
    expect(d.status).toBe("running");
    expect(d.gates.find((g) => g.name === "Minimum sample per variant")?.passed).toBe(false);
  });
  it("refuses to trust results when the traffic split is broken (SRM)", () => {
    const a = arm("a", true, 40, 1, 700);
    const b = arm("b", false, 60, 2, 300);
    const d = decideWinner([a, b], cfg(10), createRng(1));
    expect(d.srm.isMismatched).toBe(true);
    expect(d.status).not.toBe("winner_found");
  });
  it("does not declare a winner between two identical arms", () => {
    const a = arm("a", true, 50, 5);
    const b = { ...arm("b", false, 50, 5), scores: [...a.scores].reverse() };
    const d = decideWinner([a, b], cfg(10), createRng(1));
    expect(d.status).not.toBe("winner_found");
  });
  it("calls the test inconclusive once max run time passes with no winner", () => {
    const a = arm("a", true, 50, 5);
    const b = { ...arm("b", false, 50, 5), scores: [...a.scores].reverse() };
    const d = decideWinner([a, b], cfg(61), createRng(1));
    expect(d.status).toBe("inconclusive");
  });
});
