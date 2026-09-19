import { EditorApi, type EditorBoot } from "../../editor/src/api.js";
import { elementBoxes, LAYER_LABELS, pointBlobs, rgba, scrollBands, type HeatBin, type Rect } from "./layout.js";

/**
 * Heatmap overlay entry (docs/PLAN.md section 7). Loaded by the WordPress plugin's editor bridge only for
 * a verified hub admin holding a heatmap token, which sets window.__TCWAB_HEATMAP__ first. Read-only: it
 * fetches aggregated bins from the hub and paints them over the live page inside a closed Shadow DOM, so
 * the site's CSS cannot restyle it and it never intercepts a click.
 */
declare global {
  interface Window {
    __TCWAB_HEATMAP__?: EditorBoot;
  }
}

type Layer = HeatBin["layer"];
const LAYERS: Layer[] = ["click", "hover", "attention", "scroll", "rage", "dead"];
const DEVICES = ["all", "desktop", "tablet", "mobile"] as const;

interface HeatResponse {
  variants: Array<{ key: string; label: string }>;
  sessions: number;
  bins: HeatBin[];
  scrollReachPct: Array<{ depthPct: number; sessionsPct: number }>;
}

const CSS = `
:host{all:initial}
.panel{position:fixed;top:12px;right:12px;width:248px;box-sizing:border-box;padding:12px;border-radius:10px;background:#0f172a;color:#f1f5f9;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:auto}
.panel h1{margin:0 0 8px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
label{display:block;font-size:11px;color:#94a3b8;margin-top:8px}
select,button{font:inherit;color:inherit;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:4px 6px}
select{width:100%}
button{cursor:pointer}
button[aria-pressed=true]{background:#2563eb;border-color:#3b82f6}
.layers{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.status{margin-top:8px;font-size:11px;color:#94a3b8}
.legend{height:6px;border-radius:3px;margin-top:8px}
.canvas{position:absolute;left:0;top:0;pointer-events:none}
.tag{position:absolute;font:600 11px system-ui,sans-serif;color:#fff;background:rgba(15,23,42,.8);padding:1px 5px;border-radius:4px}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css?: string, text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Page-coordinate box of the first element matching a selector, or null when it does not (or no longer) exist. */
function resolveOnPage(selector: string): Rect | null {
  try {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  const cfg = window.__TCWAB_HEATMAP__;
  if (!cfg) return;
  const api = new EditorApi(cfg);

  const host = el("div", "all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;");
  const root = host.attachShadow({ mode: "closed" });
  const style = el("style");
  style.textContent = CSS;
  const canvas = el("div");
  canvas.className = "canvas";
  const panel = el("div");
  panel.className = "panel";
  root.append(style, canvas, panel);
  document.documentElement.appendChild(host); // not body: a positioned body would offset the page-coordinate canvas

  let variant = cfg.variantKey;
  let device: (typeof DEVICES)[number] = "all";
  let layer: Layer = "click";
  let data: HeatResponse | null = null;
  let error = "";

  const title = el("h1", undefined, "Heatmap");
  const close = el("button", undefined, "Close");
  close.onclick = () => host.remove();
  title.appendChild(close);

  const variantSelect = el("select");
  variantSelect.setAttribute("aria-label", "Variant");
  const deviceSelect = el("select");
  deviceSelect.setAttribute("aria-label", "Device");
  for (const d of DEVICES) {
    const o = el("option", undefined, d === "all" ? "All devices" : d[0].toUpperCase() + d.slice(1));
    o.value = d;
    deviceSelect.appendChild(o);
  }
  const layerRow = el("div");
  layerRow.className = "layers";
  const status = el("div");
  status.className = "status";
  const legend = el("div");
  legend.className = "legend";
  panel.append(title, el("label", undefined, "Variant"), variantSelect, el("label", undefined, "Device"), deviceSelect, layerRow, legend, status);

  const layerButtons = new Map<Layer, HTMLButtonElement>();
  for (const l of LAYERS) {
    const b = el("button", undefined, LAYER_LABELS[l]);
    b.onclick = () => {
      layer = l;
      draw();
    };
    layerButtons.set(l, b);
    layerRow.appendChild(b);
  }

  function draw(): void {
    canvas.textContent = "";
    for (const [l, b] of layerButtons) b.setAttribute("aria-pressed", String(l === layer));
    legend.style.background = `linear-gradient(90deg,${rgba(layer, 0.08)},${rgba(layer, 0.9)})`;
    if (error) {
      status.textContent = error;
      return;
    }
    if (!data) {
      status.textContent = "Loading...";
      return;
    }
    const doc = document.documentElement;
    const w = Math.max(doc.scrollWidth, doc.clientWidth);
    const h = Math.max(doc.scrollHeight, doc.clientHeight);
    canvas.style.cssText = `width:${w}px;height:${h}px;`;

    let unmapped = 0;
    let shapes = 0;
    if (layer === "scroll") {
      for (const b of scrollBands(data.bins, h)) {
        if (b.intensity <= 0) continue;
        shapes++;
        const band = el("div", `position:absolute;left:0;width:100%;top:${b.top}px;height:${b.height}px;background:${rgba("scroll", 0.08 + 0.42 * b.intensity)};`);
        const tag = el("span", `top:${b.top + 2}px;right:8px;`, `${b.sharePct}% of stops`);
        tag.className = "tag";
        canvas.append(band, tag);
      }
    } else if (layer === "hover" || layer === "attention") {
      const { boxes, unmapped: u } = elementBoxes(data.bins, layer, resolveOnPage);
      unmapped = u;
      for (const b of boxes) {
        shapes++;
        canvas.appendChild(el("div", `position:absolute;box-sizing:border-box;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;background:${rgba(layer, 0.08 + 0.4 * b.intensity)};outline:2px solid ${rgba(layer, 0.7)};`));
        const tag = el("span", `left:${b.left + 4}px;top:${b.top + 4}px;`, String(b.count));
        tag.className = "tag";
        canvas.appendChild(tag);
      }
    } else {
      const { blobs, unmapped: u } = pointBlobs(data.bins, layer, resolveOnPage);
      unmapped = u;
      for (const b of blobs) {
        shapes++;
        canvas.appendChild(
          el("div", `position:absolute;left:${b.x - b.radius}px;top:${b.y - b.radius}px;width:${b.radius * 2}px;height:${b.radius * 2}px;border-radius:50%;background:radial-gradient(circle,${rgba(layer, 0.25 + 0.6 * b.intensity)} 0%,${rgba(layer, 0)} 70%);`),
        );
      }
    }
    const parts = [`${data.sessions} sessions`, shapes === 0 ? `no ${LAYER_LABELS[layer].toLowerCase()} recorded` : `${shapes} shown`];
    if (unmapped > 0) parts.push(`${unmapped} element${unmapped === 1 ? "" : "s"} not found on this page`);
    status.textContent = parts.join(" - ");
  }

  async function load(): Promise<void> {
    const q = new URLSearchParams({ variant });
    if (device !== "all") q.set("device", device);
    try {
      data = await api.call<HeatResponse>("GET", `/editor/heatmap?${q}`);
      error = "";
      if (variantSelect.options.length === 0) {
        for (const v of data.variants) {
          const o = el("option", undefined, v.label);
          o.value = v.key;
          variantSelect.appendChild(o);
        }
        variantSelect.value = variant;
      }
    } catch (e) {
      error = `Could not load heat data: ${(e as Error).message}`;
    }
    draw();
  }

  variantSelect.onchange = () => {
    variant = variantSelect.value;
    void load();
  };
  deviceSelect.onchange = () => {
    device = deviceSelect.value as (typeof DEVICES)[number];
    void load();
  };

  api.onAuthLost = (reason) => {
    error = `Heatmap session ended (${reason}). Open it again from the hub.`;
    draw();
  };
  api.startRenewing();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const redraw = () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  };
  window.addEventListener("resize", redraw);
  window.addEventListener("load", redraw);
  // Late-rendering themes and builders shift elements after first paint.
  setTimeout(draw, 1500);

  draw();
  await load();
}

void boot();
