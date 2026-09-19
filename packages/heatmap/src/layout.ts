import type { HeatLayer } from "@tcw/shared";

// Mirrors HEAT_GRID and SCROLL_BINS in @tcw/shared. Not imported: the shared index pulls in node:crypto,
// which cannot go into a browser bundle (layout.test.ts asserts the two stay equal).
export const GRID = 10;
export const BANDS = 20;

/** One aggregated bin as the hub's GET /editor/heatmap returns it. */
export interface HeatBin {
  layer: HeatLayer;
  selector: string;
  cellX: number;
  cellY: number;
  count: number;
  weight: number;
}

/** A box in page coordinates (scroll offset already added). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Resolve = (selector: string) => Rect | null;

/** A soft spot of heat: drawn as a radial gradient centred on (x, y). */
export interface Blob {
  x: number;
  y: number;
  radius: number;
  /** 0-1 */
  intensity: number;
}

/** An element tinted as a whole (hover, attention). */
export interface Box extends Rect {
  intensity: number;
  count: number;
  selector: string;
}

export interface Band {
  top: number;
  height: number;
  intensity: number;
  sharePct: number;
}

export const LAYER_COLORS: Record<HeatLayer, [number, number, number]> = {
  click: [239, 68, 68],
  rage: [217, 70, 239],
  dead: [100, 116, 139],
  hover: [249, 115, 22],
  attention: [34, 197, 94],
  scroll: [59, 130, 246],
};

export const LAYER_LABELS: Record<HeatLayer, string> = {
  click: "Clicks",
  hover: "Hover",
  attention: "Attention",
  scroll: "Scroll stops",
  rage: "Rage clicks",
  dead: "Dead clicks",
};

const MIN_BLOB_RADIUS = 16;
const MAX_BLOB_RADIUS = 48;

/**
 * Click-like layers (click, rage, dead): each grid cell of each element becomes a blob at the
 * cell's centre, sized and weighted by its share of the busiest cell. Elements that no longer
 * resolve on the page are counted in `unmapped`, not drawn.
 */
export function pointBlobs(bins: HeatBin[], layer: HeatLayer, resolve: Resolve): { blobs: Blob[]; unmapped: number } {
  const rows = bins.filter((b) => b.layer === layer && b.selector);
  const max = Math.max(1, ...rows.map((b) => b.count));
  const cache = new Map<string, Rect | null>();
  const unmappedSelectors = new Set<string>();
  const blobs: Blob[] = [];
  for (const b of rows) {
    if (!cache.has(b.selector)) cache.set(b.selector, resolve(b.selector));
    const r = cache.get(b.selector);
    if (!r || r.width <= 0 || r.height <= 0) {
      unmappedSelectors.add(b.selector);
      continue;
    }
    const intensity = b.count / max;
    blobs.push({
      x: r.left + ((b.cellX + 0.5) / GRID) * r.width,
      y: r.top + ((b.cellY + 0.5) / GRID) * r.height,
      radius: MIN_BLOB_RADIUS + (MAX_BLOB_RADIUS - MIN_BLOB_RADIUS) * intensity,
      intensity,
    });
  }
  return { blobs, unmapped: unmappedSelectors.size };
}

/** Element-level layers (hover, attention): one box per element, tinted by its share of the busiest one. */
export function elementBoxes(bins: HeatBin[], layer: HeatLayer, resolve: Resolve): { boxes: Box[]; unmapped: number } {
  const perSelector = new Map<string, number>();
  for (const b of bins) if (b.layer === layer && b.selector) perSelector.set(b.selector, (perSelector.get(b.selector) ?? 0) + b.count);
  const max = Math.max(1, ...perSelector.values());
  const boxes: Box[] = [];
  let unmapped = 0;
  for (const [selector, count] of perSelector) {
    const r = resolve(selector);
    if (!r || r.width <= 0 || r.height <= 0) {
      unmapped++;
      continue;
    }
    boxes.push({ ...r, intensity: count / max, count, selector });
  }
  return { boxes, unmapped };
}

/** Scroll stops: BANDS horizontal bands over the full page height. */
export function scrollBands(bins: HeatBin[], pageHeight: number): Band[] {
  const per = new Array<number>(BANDS).fill(0);
  for (const b of bins) if (b.layer === "scroll" && b.cellY >= 0 && b.cellY < BANDS) per[b.cellY] += b.count;
  const max = Math.max(1, ...per);
  const total = per.reduce((n, c) => n + c, 0);
  const h = pageHeight / BANDS;
  return per.map((c, i) => ({ top: i * h, height: h, intensity: c / max, sharePct: total > 0 ? Math.round((c / total) * 1000) / 10 : 0 }));
}

export const rgba = (layer: HeatLayer, alpha: number): string => {
  const [r, g, b] = LAYER_COLORS[layer];
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
};
