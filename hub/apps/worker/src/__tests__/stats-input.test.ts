import { describe, expect, it } from "vitest";
import { buildVariantData } from "../stats-input.js";

const variantRows = [
  { id: "v-a", key: "a", isControl: true, trafficWeight: 50 },
  { id: "v-b", key: "b", isControl: false, trafficWeight: 50 },
];
const pv = (variantId: string, sessionId: string, over = {}) => ({
  variantId, sessionId, activeMs: 60_000, maxScrollPct: "80.00", clicked: false, rageClicks: 0, ...over,
});

describe("buildVariantData", () => {
  it("groups sessions per variant and counts clicks", () => {
    const rows = [pv("v-a", "s1"), pv("v-a", "s2", { clicked: true }), pv("v-b", "s3", { clicked: true }), pv("v-b", "s4", { clicked: true })];
    const data = buildVariantData(variantRows, rows, new Set(), 500, "post");
    expect(data.map((d) => [d.key, d.sessions, d.clicks])).toEqual([["a", 2, 1], ["b", 2, 2]]);
    expect(data[0].isControl).toBe(true);
    expect(data[0].weight).toBe(50);
  });
  it("scores every session in [0,100], and a click/hover raises the score", () => {
    const rows = [pv("v-a", "plain"), pv("v-a", "engaged", { clicked: true })];
    const data = buildVariantData(variantRows, rows, new Set(["engaged"]), 500, "page");
    const [plain, engaged] = data[0].scores;
    expect(plain).toBeGreaterThanOrEqual(0);
    expect(engaged).toBeLessThanOrEqual(100);
    expect(engaged).toBeGreaterThan(plain);
  });
  it("a quick bounce scores 0", () => {
    const rows = [pv("v-a", "bounce", { activeMs: 1000, maxScrollPct: "0" })];
    expect(buildVariantData(variantRows, rows, new Set(), 500, "post")[0].scores).toEqual([0]);
  });
  it("returns an empty arm for a variant with no sessions", () => {
    const data = buildVariantData(variantRows, [pv("v-a", "s1")], new Set(), 500, "post");
    expect(data[1]).toMatchObject({ key: "b", sessions: 0, clicks: 0, scores: [] });
  });
});
