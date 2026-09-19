import { describe, expect, it } from "vitest";
import { deriveHeatBins } from "../heat.js";
import type { QueuedTrackerEventInput } from "@tcw/shared";

const ev = (over: Partial<QueuedTrackerEventInput>): QueuedTrackerEventInput => ({
  siteId: "11111111-1111-4111-8111-111111111111",
  testId: "22222222-2222-4222-8222-222222222222",
  variantKey: "a",
  visitorId: "33333333-3333-4333-8333-333333333333",
  sessionId: "44444444-4444-4444-8444-444444444444",
  device: "desktop",
  type: "click",
  ts: 1,
  url: "https://example.com/",
  ...over,
});

describe("deriveHeatBins", () => {
  it("click: bins the offset into a 10x10 grid", () => {
    expect(deriveHeatBins(ev({ data: { sel: "#cta", ox: 0, oy: 0 } }))).toEqual([{ layer: "click", selector: "#cta", cellX: 0, cellY: 0, count: 1, weight: 1 }]);
    const [b] = deriveHeatBins(ev({ data: { sel: "#cta", ox: 55, oy: 99 } }));
    expect([b.cellX, b.cellY]).toEqual([5, 9]);
    const [edge] = deriveHeatBins(ev({ data: { sel: "#cta", ox: 100, oy: 100 } }));
    expect([edge.cellX, edge.cellY]).toEqual([9, 9]); // 100% stays inside the grid
  });

  it("click: a dead click also lands on the dead layer", () => {
    const bins = deriveHeatBins(ev({ data: { sel: "p", ox: 10, oy: 10, dead: true } }));
    expect(bins.map((b) => b.layer)).toEqual(["click", "dead"]);
  });

  it("clicks with no usable selector contribute nothing", () => {
    expect(deriveHeatBins(ev({ data: { x: 1, y: 2 } }))).toEqual([]);
    expect(deriveHeatBins(ev({ data: { sel: "" } }))).toEqual([]);
    expect(deriveHeatBins(ev({ data: { sel: "a".repeat(301) } }))).toEqual([]);
    expect(deriveHeatBins(ev({ data: { sel: "a\nb" } }))).toEqual([]);
    expect(deriveHeatBins(ev({ data: { sel: 42 } }))).toEqual([]);
  });

  it("garbage offsets are clamped, not stored raw", () => {
    const [b] = deriveHeatBins(ev({ data: { sel: "#x", ox: 9e9, oy: -5 } }));
    expect([b.cellX, b.cellY]).toEqual([9, 0]);
    const [c] = deriveHeatBins(ev({ data: { sel: "#x", ox: "7", oy: NaN } }));
    expect([c.cellX, c.cellY]).toEqual([0, 0]);
  });

  it("rage_click: lands on the rage layer at the click position", () => {
    expect(deriveHeatBins(ev({ type: "rage_click", data: { count: 4, sel: "#x", ox: 30, oy: 60 } }))).toEqual([
      { layer: "rage", selector: "#x", cellX: 3, cellY: 6, count: 1, weight: 1 },
    ]);
  });

  it("hover: weighted by seconds, capped at 30s", () => {
    expect(deriveHeatBins(ev({ type: "hover", data: { sel: "a.buy", durationMs: 2500 } }))[0]).toMatchObject({ layer: "hover", weight: 2.5 });
    expect(deriveHeatBins(ev({ type: "hover", data: { sel: "a.buy", durationMs: 9e7 } }))[0].weight).toBe(30);
    expect(deriveHeatBins(ev({ type: "hover", data: { durationMs: 900 } }))).toEqual([]);
  });

  it("section_view: one attention hit per element", () => {
    expect(deriveHeatBins(ev({ type: "section_view", data: { sel: "h2:nth-of-type(2)", ms: 1000, total: 8 } }))).toEqual([
      { layer: "attention", selector: "h2:nth-of-type(2)", cellX: 0, cellY: 0, count: 1, weight: 1 },
    ]);
  });

  it("scroll_stop: 5% bands of page height, needs no selector", () => {
    const band = (pct: number) => deriveHeatBins(ev({ type: "scroll_stop", data: { pct } }))[0];
    expect(band(0)).toMatchObject({ layer: "scroll", selector: "", cellY: 0 });
    expect(band(4.9).cellY).toBe(0);
    expect(band(5).cellY).toBe(1);
    expect(band(50).cellY).toBe(10);
    expect(band(100).cellY).toBe(19);
    expect(band(400).cellY).toBe(19);
  });

  it("other events contribute nothing", () => {
    for (const type of ["pageview", "heartbeat", "scroll_depth", "visibility_end"] as const) {
      expect(deriveHeatBins(ev({ type, data: { sel: "#x" } }))).toEqual([]);
    }
  });
});
