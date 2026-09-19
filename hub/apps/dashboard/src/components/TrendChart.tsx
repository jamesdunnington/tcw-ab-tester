export interface TrendPoint {
  computedAt: string;
  leaderPBest: number;
}

interface Props {
  points: TrendPoint[];
  /** The confidence threshold to draw as a dashed reference line, e.g. 0.95. */
  threshold: number;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

/**
 * Leader's probability-of-being-best over time. Fewer than 4 points is not a
 * trend, so it falls back to a plain statement. The line is paired with a
 * visible data table and a dashed threshold line (not color alone).
 */
export function TrendChart({ points, threshold }: Props) {
  if (points.length < 4) {
    const last = points[points.length - 1];
    return (
      <p className="muted">
        {last ? `Latest confidence: ${(last.leaderPBest * 100).toFixed(1)}%. A trend appears after a few hourly updates.` : "No statistics computed yet. The first update runs within the hour."}
      </p>
    );
  }

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.leaderPBest).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Leader confidence over time, latest ${(last.leaderPBest * 100).toFixed(1)} percent, threshold ${(threshold * 100).toFixed(0)} percent`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end">{Math.round(t * 100)}%</text>
          </g>
        ))}
        <line className="threshold" x1={PAD.left} x2={W - PAD.right} y1={y(threshold)} y2={y(threshold)} />
        <text x={PAD.left + 6} y={y(threshold) - 6} textAnchor="start">Threshold {(threshold * 100).toFixed(0)}%</text>
        <path className="line" d={d} />
      </svg>
      <details>
        <summary className="small">View as table</summary>
        <div className="table-wrap">
          <table className="data-table">
            <caption>Confidence history</caption>
            <thead><tr><th>Computed</th><th className="num">Leader P(best)</th></tr></thead>
            <tbody>
              {points.slice(-24).reverse().map((p) => (
                <tr key={p.computedAt}><td>{new Date(p.computedAt).toLocaleString()}</td><td className="num">{(p.leaderPBest * 100).toFixed(1)}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
