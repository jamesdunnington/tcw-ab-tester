import { describe, expect, it } from "vitest";
import { BANDS, GRID, elementBoxes, pointBlobs, rgba, scrollBands, type HeatBin, type Rect } from "../layout.js";
import { HEAT_GRID, HEAT_LAYERS, SCROLL_BINS } from "@tcw/shared";
import { LAYER_COLORS, LAYER_LABELS } from "../layout.js";

const bin = (over: Partial<HeatBin>): HeatBin => ({ layer: "click", selector: "#cta", cellX: 0, cellY: 0, count: 1, weight: 1, ...over });
const page: Record<string, Rect> = { "#cta": { left: 100, top: 200, width: 200, height: 100 }, ".gone": { left: 0, top: 0, width: 0, height: 0 } };
const resolve = (s: string) => page[s] ?? null;

describe("heatmap layout", () => {
  it("mirrors the shared grid constants and covers every layer", () => {
    expect(GRID).toBe(HEAT_GRID);
    expect(BANDS).toBe(SCROLL_BINS);
    for (const l of HEAT_LAYERS) {
      expect(LAYER_COLORS[l]).toBeDefined();
      expect(LAYER_LABELS[l]).toBeDefined();
    }
  });

  it("places a click blob at the centre of its grid cell inside the element", () => {
    const { blobs } = pointBlobs([bin({ cellX: 0, cellY: 0, count: 4 })], "click", resolve);
    // cell (0,0) of a 200x100 box at (100,200): centre = 100 + 0.5/10*200, 200 + 0.5/10*100
    expect(blobs[0]).toMatchObject({ x: 110, y: 205, intensity: 1 });
    const [c] = pointBlobs([bin({ cellX: 9, cellY: 9 })], "click", resolve).blobs;
    expect([c.x, c.y]).toEqual([290, 295]);
  });

  it("scales intensity and size by the busiest cell", () => {
    const { blobs } = pointBlobs([bin({ count: 10 }), bin({ cellX: 5, count: 5 })], "click", resolve);
    expect(blobs.map((b) => b.intensity)).toEqual([1, 0.5]);
    expect(blobs[0].radius).toBeGreaterThan(blobs[1].radius);
  });

  it("counts elements it cannot find or that have no size, without drawing them", () => {
    const out = pointBlobs([bin({ selector: ".gone" }), bin({ selector: ".missing" }), bin({ selector: ".missing", cellX: 2 })], "click", resolve);
    expect(out.blobs).toEqual([]);
    expect(out.unmapped).toBe(2); // per element, not per cell
  });

  it("only draws the requested layer", () => {
    const bins = [bin({ layer: "click" }), bin({ layer: "rage" })];
    expect(pointBlobs(bins, "rage", resolve).blobs).toHaveLength(1);
  });

  it("element layers sum an element's cells and tint by share of the busiest", () => {
    const { boxes } = elementBoxes([bin({ layer: "attention", count: 6 }), bin({ layer: "attention", cellX: 1, count: 2 })], "attention", resolve);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ selector: "#cta", count: 8, intensity: 1, left: 100, width: 200 });
  });

  it("scroll bands cover the page height and share out the stops", () => {
    const bands = scrollBands([bin({ layer: "scroll", selector: "", cellY: 0, count: 3 }), bin({ layer: "scroll", selector: "", cellY: 19, count: 1 })], 2000);
    expect(bands).toHaveLength(20);
    expect(bands[0]).toMatchObject({ top: 0, height: 100, intensity: 1, sharePct: 75 });
    expect(bands[19]).toMatchObject({ top: 1900, sharePct: 25 });
    expect(bands[5].intensity).toBe(0);
  });

  it("rgba clamps alpha", () => {
    expect(rgba("click", 5)).toBe("rgba(239,68,68,1.000)");
    expect(rgba("click", -1)).toBe("rgba(239,68,68,0.000)");
  });
});
