import { describe, expect, it } from "vitest";
import { summarizeHeat, type HeatBinRow } from "../services/heatmap.js";

const bin = (over: Partial<HeatBinRow>): HeatBinRow => ({ layer: "click", selector: "#cta", cellX: 0, cellY: 0, count: 1, weight: 1, ...over });
const reach = (pcts: number[]) => pcts.map((p, i) => ({ depthPct: (i + 1) * 10, sessionsPct: p }));

describe("summarizeHeat", () => {
  it("ranks elements by clicks, sums their cells and reports the hottest cell", () => {
    const s = summarizeHeat({
      sessions: 100,
      scrollReachPct: [],
      bins: [
        bin({ selector: "#cta", cellX: 2, cellY: 3, count: 30 }),
        bin({ selector: "#cta", cellX: 5, cellY: 5, count: 10 }),
        bin({ selector: "a.nav", count: 20 }),
        bin({ selector: "img.hero", count: 40 }),
      ],
    });
    expect(s.click.total).toBe(100);
    expect(s.click.top.map((t) => [t.selector, t.count, t.sharePct])).toEqual([
      ["#cta", 40, 40],
      ["img.hero", 40, 40],
      ["a.nav", 20, 20],
    ]);
    expect(s.click.top[0].hotspot).toEqual({ cellX: 2, cellY: 3 });
  });

  it("hover reports average seconds, attention reports the share of sessions", () => {
    const s = summarizeHeat({
      sessions: 50,
      scrollReachPct: [],
      bins: [bin({ layer: "hover", selector: "a.buy", count: 4, weight: 10 }), bin({ layer: "attention", selector: "h2", count: 20, weight: 20 })],
    });
    expect(s.hover.top[0]).toMatchObject({ selector: "a.buy", avgHoverSeconds: 2.5 });
    expect(s.attention.top[0]).toMatchObject({ selector: "h2", sessionsPct: 40 });
  });

  it("splits dead and rage clicks into their own lists", () => {
    const s = summarizeHeat({
      sessions: 10,
      scrollReachPct: [],
      bins: [bin({ layer: "dead", selector: "p.intro", count: 6 }), bin({ layer: "rage", selector: "#buy", count: 2 })],
    });
    expect(s.deadClicks).toMatchObject({ total: 6, top: [{ selector: "p.intro" }] });
    expect(s.rageClicks).toMatchObject({ total: 2, top: [{ selector: "#buy" }] });
    expect(s.click.total).toBe(0);
  });

  it("scroll stops: 20 five-percent bands, busiest band named", () => {
    const s = summarizeHeat({
      sessions: 10,
      scrollReachPct: [],
      bins: [bin({ layer: "scroll", selector: "", cellY: 4, count: 6 }), bin({ layer: "scroll", selector: "", cellY: 10, count: 2 })],
    });
    expect(s.scroll.stops).toHaveLength(20);
    expect(s.scroll.busiestBand).toEqual({ fromPct: 20, toPct: 25 });
    expect(s.scroll.stops[4].sharePct).toBe(75);
  });

  it("finds where most people leave from the reach curve", () => {
    const s = summarizeHeat({ sessions: 100, bins: [], scrollReachPct: reach([95, 90, 85, 40, 35, 30, 28, 20, 15, 10]) });
    expect(s.scroll.biggestDropAtPct).toBe(40); // 85 -> 40 is the steepest fall
  });

  it("is empty and safe with no data", () => {
    const s = summarizeHeat({ sessions: 0, bins: [], scrollReachPct: reach(new Array(10).fill(0)) });
    expect(s.click).toEqual({ total: 0, top: [] });
    expect(s.scroll.busiestBand).toBeNull();
    expect(s.scroll.biggestDropAtPct).toBeNull();
  });
});
