import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { Icon } from "../components/Icon.js";
import { StatusBadge } from "../components/StatusBadge.js";
import type { OverviewResponse, OverviewTest } from "../lib/types.js";

const fmtLift = (n: number | null | undefined) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "—");
const fmtPct = (n: number | null | undefined) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "—");

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ov-metric">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
      {sub && <span className="ov-sub">{sub}</span>}
    </div>
  );
}

function TestRow({ test }: { test: OverviewTest }) {
  const decide = test.group === "decide";
  const checks = test.gatesTotal > 0 ? Math.round((test.gatesPassed / test.gatesTotal) * 100) : 0;
  return (
    <li className="ov-row">
      <div className="ov-main">
        <p className="ov-site">{test.siteName} <span className="muted">· {test.siteDomain}</span></p>
        <h3 className="ov-name">{test.name}</h3>
        <p className="ov-status">
          <StatusBadge status={test.status} />
          <span className="muted small">{test.type === "element" ? "Elements" : "Whole page"}</span>
        </p>
        {test.gatesTotal > 0 && (
          <p className="ov-checks small muted">
            <span className="meter" role="img" aria-label={`${test.gatesPassed} of ${test.gatesTotal} checks passed`}><span style={{ width: `${checks}%` }} /></span>
            {test.gatesPassed} of {test.gatesTotal} checks passed
          </p>
        )}
      </div>
      <dl className="ov-metrics">
        <Metric label="Lift" value={fmtLift(test.leader?.liftPct)} sub={test.leader ? `${test.leader.label} leads` : "No signal yet"} />
        <Metric label="Confidence" value={fmtPct(test.leader?.pBest)} />
        <Metric label="Sessions" value={test.sessions.toLocaleString()} />
        <Metric label="Days" value={String(test.daysRunning)} sub={`min ${test.minRunDays}`} />
      </dl>
      <div className="ov-actions">
        <Link to={`/tests/${test.id}`} className={decide ? "btn" : "btn btn-secondary"}>
          {decide ? "Review and decide" : "Open test"}
          <span className="visually-hidden"> for {test.name} on {test.siteName}</span>
        </Link>
        <Link to={`/sites/${test.siteId}/tests`} className="ov-sitelink small">All tests on this site<span className="visually-hidden"> ({test.siteName})</span></Link>
      </div>
    </li>
  );
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState(false);
  const [params, setParams] = useSearchParams();
  const siteFilter = params.get("site") ?? "";

  const load = useCallback(() => {
    setError(false);
    api.get<OverviewResponse>("/api/overview").then(setData).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  function setSite(id: string) {
    setParams(id ? { site: id } : {}, { replace: true });
  }

  const visible = (data?.tests ?? []).filter((t) => !siteFilter || t.siteId === siteFilter);
  const decide = visible.filter((t) => t.group === "decide");
  const live = visible.filter((t) => t.group === "live");
  const activeSites = (data?.sites ?? []).filter((s) => s.live + s.decide > 0).length;
  const selectedSite = data?.sites.find((s) => s.id === siteFilter);

  return (
    <div>
      <h1>Overview</h1>
      <p className="muted">Every test that is running or waiting on you, across all your sites.</p>

      {error && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" />
          <div>Could not load the overview. <button type="button" className="link-button" onClick={load}>Try again</button></div>
        </div>
      )}

      {!data && !error && <div aria-busy="true" aria-label="Loading overview"><div className="skeleton" style={{ height: 96, marginBottom: 24 }} /><div className="skeleton" style={{ height: 220 }} /></div>}

      {data && (
        <>
          <div className="kpi-grid ov-kpis">
            <div className="kpi"><div className="label">Waiting on you</div><div className="value">{decide.length}</div><div className="sub">winner ready or stopped</div></div>
            <div className="kpi"><div className="label">Live now</div><div className="value">{live.length}</div><div className="sub">still collecting visitors</div></div>
            <div className="kpi"><div className="label">Sites with activity</div><div className="value">{selectedSite ? (selectedSite.live + selectedSite.decide > 0 ? 1 : 0) : activeSites}<span className="ov-of"> / {selectedSite ? 1 : data.sites.length}</span></div><div className="sub">have a live or waiting test</div></div>
          </div>

          {data.sites.length > 1 && (
            <div className="field ov-filter">
              <label htmlFor="ov-site">Show</label>
              <select id="ov-site" value={siteFilter} onChange={(e) => setSite(e.target.value)}>
                <option value="">All sites</option>
                {data.sites.map((s) => <option key={s.id} value={s.id}>{s.displayName}{s.live + s.decide > 0 ? ` (${s.decide} waiting, ${s.live} live)` : ""}</option>)}
              </select>
            </div>
          )}

          <h2>Needs your decision <span className="ov-count num">{decide.length}</span></h2>
          {decide.length === 0 ? (
            <p className="empty">Nothing is waiting on you. A test shows up here when a winner is ready or you stop it.</p>
          ) : (
            <ul className="ov-list">{decide.map((t) => <TestRow key={t.id} test={t} />)}</ul>
          )}

          <h2>Live now <span className="ov-count num">{live.length}</span></h2>
          {live.length === 0 ? (
            <p className="empty">No test is running{selectedSite ? ` on ${selectedSite.displayName}` : ""}. Start one from <Link to="/sites">Sites</Link>.</p>
          ) : (
            <ul className="ov-list">{live.map((t) => <TestRow key={t.id} test={t} />)}</ul>
          )}
        </>
      )}
    </div>
  );
}
