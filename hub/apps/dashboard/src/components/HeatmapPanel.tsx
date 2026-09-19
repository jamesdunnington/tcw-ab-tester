import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { HeatTopElement, HeatmapResponse, Variant } from "../lib/types.js";

type LayerKey = "click" | "hover" | "attention" | "deadClicks" | "rageClicks";

const LAYERS: Array<{ key: LayerKey; label: string; blurb: string; countLabel: string }> = [
  { key: "click", label: "Clicks", blurb: "The elements people click most, and where inside each one.", countLabel: "Clicks" },
  { key: "hover", label: "Hover", blurb: "Links and buttons people paused on for half a second or more.", countLabel: "Hovers" },
  { key: "attention", label: "Attention", blurb: "Headings and sections that were at least half in view for a second, as a share of sessions.", countLabel: "Sessions" },
  { key: "deadClicks", label: "Dead clicks", blurb: "Clicks on something that is not a link or button. People expected it to do something.", countLabel: "Clicks" },
  { key: "rageClicks", label: "Rage clicks", blurb: "Three or more fast clicks in one spot: frustration.", countLabel: "Bursts" },
];

const DEVICES = ["all", "desktop", "tablet", "mobile"] as const;

/** "top left", "bottom right", "centre" from a 10x10 grid cell. */
function hotspotText(h?: { cellX: number; cellY: number }): string {
  if (!h) return "";
  const col = h.cellX <= 3 ? "left" : h.cellX >= 6 ? "right" : "centre";
  const row = h.cellY <= 3 ? "top" : h.cellY >= 6 ? "bottom" : "middle";
  if (row === "middle" && col === "centre") return "centre";
  return row === "middle" ? col : col === "centre" ? row : `${row} ${col}`;
}

function detail(layer: LayerKey, el: HeatTopElement): string {
  if (layer === "hover") return `${el.avgHoverSeconds ?? 0}s avg`;
  if (layer === "attention") return `${el.sessionsPct ?? 0}% of sessions`;
  return hotspotText(el.hotspot);
}

/** Top elements per heat layer plus the scroll drop-off, with a link to the live-page overlay. */
export function HeatmapPanel({ testId, variants }: { testId: string; variants: Variant[] }) {
  const [variant, setVariant] = useState("");
  const [device, setDevice] = useState<(typeof DEVICES)[number]>("all");
  const [layer, setLayer] = useState<LayerKey>("click");
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams();
    if (variant) q.set("variant", variant);
    if (device !== "all") q.set("device", device);
    const qs = q.toString();
    let live = true;
    api
      .get<HeatmapResponse>(`/api/tests/${testId}/heatmap${qs ? `?${qs}` : ""}`)
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load the heatmap."));
    return () => {
      live = false;
    };
  }, [testId, variant, device]);

  async function openOverlay() {
    setOpening(true);
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>(`/api/tests/${testId}/heatmap-link`, { variantKey: variant || undefined });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? `Could not open the heatmap (${e.message}).` : "Could not open the heatmap.");
    } finally {
      setOpening(false);
    }
  }

  const active = LAYERS.find((l) => l.key === layer)!;
  const rows = data ? data[layer].top : [];

  return (
    <section aria-labelledby="heatmap-heading">
      <h2 id="heatmap-heading">Heatmap</h2>

      <div className="heat-toolbar">
        <div className="field">
          <label htmlFor="heat-variant">Variant</label>
          <select id="heat-variant" value={variant} onChange={(e) => setVariant(e.target.value)}>
            <option value="">All variants</option>
            {variants.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="heat-device">Device</label>
          <select id="heat-device" value={device} onChange={(e) => setDevice(e.target.value as (typeof DEVICES)[number])}>
            {DEVICES.map((d) => <option key={d} value={d}>{d === "all" ? "All devices" : d[0].toUpperCase() + d.slice(1)}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" disabled={opening} onClick={openOverlay}>
          {opening ? "Opening…" : "View on the live page"}<span className="visually-hidden"> (opens in a new tab, WordPress login required)</span>
        </button>
      </div>

      {error && <div className="banner banner-danger" role="alert"><div>{error}</div></div>}

      {!data && !error && <div className="skeleton" style={{ height: 160 }} aria-busy="true" aria-label="Loading heatmap" />}

      {data && data.sessions === 0 && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No heat data yet. It appears once visitors who accepted statistics cookies have viewed the page.</p></div>
      )}

      {data && data.sessions > 0 && (
        <>
          <div className="heat-layers" role="group" aria-label="Heat layer">
            {LAYERS.map((l) => (
              <button key={l.key} type="button" aria-pressed={layer === l.key} onClick={() => setLayer(l.key)}>
                {l.label} <span className="num">({data[l.key].total})</span>
              </button>
            ))}
          </div>
          <p className="muted small">{active.blurb} Based on {data.sessions} sessions.</p>

          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Top elements for {active.label.toLowerCase()}</caption>
              <thead>
                <tr><th>Element</th><th className="num">{active.countLabel}</th><th className="num">Share</th><th>{layer === "hover" || layer === "attention" ? "Detail" : "Hottest spot"}</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={4} className="muted">Nothing recorded for this layer.</td></tr>}
                {rows.map((el) => (
                  <tr key={el.selector}>
                    <td className="selector-cell">{el.selector}</td>
                    <td className="num">{el.count}</td>
                    <td className="num">{el.sharePct}%</td>
                    <td>{detail(layer, el)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 24 }}>Scroll drop-off</h3>
          <p className="muted small">
            Share of sessions that scrolled at least this far.
            {data.scroll.biggestDropAtPct !== null && <> The biggest loss is by <strong>{data.scroll.biggestDropAtPct}%</strong> of the page.</>}
            {data.scroll.busiestBand && <> Scrolling paused most between {data.scroll.busiestBand.fromPct}% and {data.scroll.busiestBand.toPct}%.</>}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Scroll reach by page depth</caption>
              <thead><tr><th>Depth</th><th>Reached by</th></tr></thead>
              <tbody>
                {data.scroll.reachPct.map((r) => (
                  <tr key={r.depthPct}>
                    <td>{r.depthPct}%</td>
                    <td><span className="meter" aria-hidden="true"><span style={{ width: `${r.sessionsPct}%` }} /></span><span className="num">{r.sessionsPct}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
