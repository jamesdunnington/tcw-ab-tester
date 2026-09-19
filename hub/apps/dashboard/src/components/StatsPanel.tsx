import type { StatsResponse, Variant } from "../lib/types.js";
import { Icon } from "./Icon.js";
import { TrendChart } from "./TrendChart.js";

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

interface Props {
  stats: StatsResponse;
  variants: Variant[];
  confidenceThreshold: number;
}

/** Leader, per-variant analysis, the gates that decide a winner, and the confidence trend. */
export function StatsPanel({ stats, variants, confidenceThreshold }: Props) {
  const latest = stats.latest;
  if (!latest) {
    return <div className="card"><p className="muted" style={{ margin: 0 }}>Statistics are computed hourly once the test is running. Use “Recompute now” to see the first result.</p></div>;
  }

  const label = (key: string) => variants.find((v) => v.key === key)?.label ?? key;
  const leader = [...latest.variants].sort((a, b) => b.pBest - a.pBest)[0];
  const failing = latest.gates.filter((g) => !g.passed);

  return (
    <>
      {latest.srm.isMismatched && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" />
          <div><strong>Traffic split looks broken.</strong> Visitors are not being divided as configured (sample ratio mismatch), so these results cannot be trusted. Check caching and redirects before continuing.</div>
        </div>
      )}

      <div className="kpi-grid">
        <div className="card kpi"><div className="label">Leading variant</div><div className="value">{label(leader.key)}</div><div className="sub">{pct(leader.pBest)} chance it is best</div></div>
        <div className="card kpi"><div className="label">Gates passed</div><div className="value num">{latest.gates.length - failing.length}/{latest.gates.length}</div><div className="sub">{failing.length === 0 ? "All conditions met" : `${failing.length} still open`}</div></div>
        <div className="card kpi"><div className="label">Last updated</div><div className="value" style={{ fontSize: "1.125rem" }}>{new Date(latest.computedAt).toLocaleString()}</div><div className="sub">Refreshes hourly</div></div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <caption>Engagement by variant</caption>
          <thead>
            <tr><th>Variant</th><th className="num">Sessions</th><th className="num">Engagement score</th><th className="num">P(best)</th><th className="num">Click rate</th><th className="num">Lift vs original (95% CI)</th></tr>
          </thead>
          <tbody>
            {latest.variants.map((v) => (
              <tr key={v.key}>
                <td>{label(v.key)}{v.key === latest.winnerKey ? " · recommended" : ""}</td>
                <td className="num">{v.sessions}</td>
                <td className="num">{v.meanScore.toFixed(1)}</td>
                <td className="num">{pct(v.pBest)}</td>
                <td className="num">{pct(v.clickRate)}</td>
                <td className="num">
                  {v.lift && v.lift.estimate !== null
                    ? `${v.lift.estimate >= 0 ? "+" : ""}${pct(v.lift.estimate)} (${pct(v.lift.ci[0], 0)} to ${pct(v.lift.ci[1], 0)})`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Why {latest.status === "winner_found" ? "there is a winner" : "no winner yet"}</h2>
      <ul className="gate-list card">
        {latest.gates.map((g) => (
          <li key={g.name} className={`gate ${g.passed ? "pass" : "fail"}`}>
            <Icon name={g.passed ? "check" : "x"} />
            <div><strong>{g.name}</strong> <span className="visually-hidden">{g.passed ? "passed" : "not met"}. </span><span className="muted">{g.detail}</span></div>
          </li>
        ))}
      </ul>

      <h2>Confidence over time</h2>
      <div className="card"><TrendChart points={stats.history} threshold={confidenceThreshold} /></div>
    </>
  );
}
