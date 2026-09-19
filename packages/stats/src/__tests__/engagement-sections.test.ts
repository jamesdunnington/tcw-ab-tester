import { describe, expect, it } from "vitest";
import { computeEngagementScore, ENGAGEMENT_PRESETS } from "../engagement-score.js";

const full = { activeMs: 10 * 60_000, maxScrollPct: 100, hovered: true, clicked: true, rageClicks: 0 };
const W = ENGAGEMENT_PRESETS.content; // sections weight 20

describe("engagement score: key sections seen", () => {
  it("matches the plan's weights (docs/PLAN.md section 5)", () => {
    expect(ENGAGEMENT_PRESETS.cta.sections).toBe(10);
    expect(ENGAGEMENT_PRESETS.content.sections).toBe(20);
    expect(ENGAGEMENT_PRESETS.landing.sections).toBe(15);
  });

  it("all sections seen keeps a perfect session at 100", () => {
    expect(computeEngagementScore({ ...full, sectionsSeen: 8, sectionsTotal: 8 }, W, 500)).toBe(100);
  });

  it("seeing fewer sections costs exactly the sections weight, pro rata", () => {
    expect(computeEngagementScore({ ...full, sectionsSeen: 0, sectionsTotal: 8 }, W, 500)).toBe(80);
    expect(computeEngagementScore({ ...full, sectionsSeen: 4, sectionsTotal: 8 }, W, 500)).toBe(90);
  });

  it("more seen than observed cannot score above the weight", () => {
    expect(computeEngagementScore({ ...full, sectionsSeen: 20, sectionsTotal: 8 }, W, 500)).toBe(100);
  });

  it("no section data: scored on the other four, rescaled, so a perfect session is still 100", () => {
    expect(computeEngagementScore(full, W, 500)).toBe(100);
    expect(computeEngagementScore({ ...full, sectionsTotal: 0 }, W, 500)).toBe(100);
  });

  it("no section data does not inflate a partial session", () => {
    const partial = { activeMs: 10 * 60_000, maxScrollPct: 50, hovered: false, clicked: false, rageClicks: 0 };
    // (35 + 12.5) / 80 * 100 = 59.375
    expect(computeEngagementScore(partial, W, 500)).toBeCloseTo(59.375, 5);
    // with section data the same session gets the sections share on top of the same 47.5 points
    expect(computeEngagementScore({ ...partial, sectionsSeen: 4, sectionsTotal: 8 }, W, 500)).toBeCloseTo(57.5, 5);
  });

  it("a quick bounce is still 0", () => {
    expect(computeEngagementScore({ activeMs: 1000, maxScrollPct: 0, hovered: false, clicked: false, rageClicks: 0, sectionsSeen: 3, sectionsTotal: 3 }, W, 500)).toBe(0);
  });
});
