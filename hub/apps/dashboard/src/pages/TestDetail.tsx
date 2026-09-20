import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { openInNewTab } from "../open-tab.js";
import type { StatsResponse, Test, Variant } from "../lib/types.js";
import { DecisionPanel } from "../components/DecisionPanel.js";
import { HeatmapPanel } from "../components/HeatmapPanel.js";
import { Icon } from "../components/Icon.js";
import { StatsPanel } from "../components/StatsPanel.js";
import { StatusBadge } from "../components/StatusBadge.js";

const LIVE = ["running", "winner_found", "inconclusive"];

export function TestDetailPage() {
  const { testId } = useParams<{ testId: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [label, setLabel] = useState("Challenger");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!testId) return;
    api
      .get<{ test: Test; variants: Variant[] }>(`/api/tests/${testId}`)
      .then((res) => {
        setTest(res.test);
        setVariants(res.variants);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this test."));
    api.get<StatsResponse>(`/api/tests/${testId}/stats`).then(setStats).catch(() => setStats(null));
  }, [testId]);

  useEffect(load, [load]);

  // The visual editor saves in another tab; refresh the edit counts when the owner comes back.
  useEffect(() => {
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  async function openEditor(variantKey: string) {
    setError(null);
    try {
      await openInNewTab(async () => (await api.post<{ url: string }>(`/api/tests/${testId}/variants/${variantKey}/editor-link`)).url);
    } catch (err) {
      setError(err instanceof Error ? `Could not open the editor (${err.message}).` : "Could not open the editor.");
    }
  }

  async function act(path: string, body: unknown, success: string, failure: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.post(`/api/tests/${testId}/${path}`, body);
      setNotice(success);
      load();
    } catch (err) {
      setError(err instanceof Error ? `${failure} (${err.message})` : failure);
    } finally {
      setBusy(false);
    }
  }

  function addVariant(e: FormEvent) {
    e.preventDefault();
    void act("variants", { label }, "The challenger was created on WordPress.", "Could not create the variant. Is the site connected and reachable?");
  }

  if (!test) {
    return error ? (
      <div className="banner banner-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>
    ) : (
      <div aria-busy="true" aria-label="Loading test">
        <div className="skeleton" style={{ height: 32, width: "50%", marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }

  const isLive = LIVE.includes(test.status) && !test.endedAt;
  const decidable = test.status === "winner_found" || test.status === "inconclusive";
  const threshold = Number(test.confidenceThreshold);
  const isElement = test.type === "element";
  const editCount = (v: Variant) => (v.changeOps ?? []).filter((o) => o.op !== "goal").length;
  const goalCount = (v: Variant) => (v.changeOps ?? []).filter((o) => o.op === "goal").length;
  const hasEdits = variants.some((v) => !v.isControl && editCount(v) > 0);
  const editable = test.status === "draft" || test.status === "qa";
  const winnerLabel = variants.find((v) => v.key === stats?.latest?.winnerKey)?.label;

  return (
    <div>
      <Link to={`/sites/${test.siteId}/tests`} className="back-link"><Icon name="back" />All tests</Link>

      <div className="page-header">
        <div>
          <h1>{test.name}</h1>
          <p className="muted small">
            <StatusBadge status={test.status} /> ·{" "}
            <a href={test.wpPermalink} target="_blank" rel="noreferrer">View original page<span className="visually-hidden"> (opens in a new tab)</span></a>
          </p>
        </div>
        <div className="form-row" style={{ flex: "0 0 auto" }}>
          {isLive && (
            <button className="btn btn-secondary" disabled={busy} onClick={() => act("recompute", undefined, "Recomputing. Refresh in a few seconds.", "Could not queue a recompute.")}>
              <Icon name="refresh" />Recompute now
            </button>
          )}
          {test.status === "running" && (
            <button className="btn btn-secondary" disabled={busy} onClick={() => act("stop", undefined, "The test was stopped.", "Could not stop the test.")}>Stop test</button>
          )}
        </div>
      </div>

      {notice && <div className="banner banner-success" role="status"><Icon name="check" /><div>{notice}</div></div>}
      {error && <div className="banner banner-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>}

      {test.status === "winner_found" && (
        <div className="banner banner-success" role="status">
          <Icon name="trophy" />
          <div><strong>{winnerLabel ?? "A variant"} is the recommended winner.</strong> Every condition is met. Decide below what the page should end up with.</div>
        </div>
      )}
      {test.status === "inconclusive" && (
        <div className="banner banner-warn">
          <Icon name="alert" />
          <div><strong>No clear winner.</strong> You can keep the original, or choose a version anyway.</div>
        </div>
      )}
      {test.status === "archived" && stats?.decision && (
        <div className="banner banner-info">
          <Icon name="archive" />
          <div>
            <strong>Decided on {new Date(stats.decision.decidedAt).toLocaleDateString()}.</strong>{" "}
            {isElement ? "The winning edits are now a permanent change on the page." : stats.decision.deleteRedundant ? "The redundant copy was deleted." : "The redundant copy was kept as a hidden draft."}{" "}
            {stats.decision.reason ? `Reason: ${stats.decision.reason} ` : ""}Results stay in the archive.
          </div>
        </div>
      )}

      <h2>Variants</h2>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">Variants in this test</caption>
          <thead>
            <tr><th>Key</th><th>Label</th><th className="num">Traffic</th><th>{isElement ? "Changes" : "Preview"}</th></tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id}>
                <td className="mono">{v.key}</td>
                <td>{v.label}{v.isControl && !/control|original/i.test(v.label) ? " (control)" : ""}</td>
                <td className="num">{v.trafficWeight}%</td>
                <td>
                  {isElement ? (
                    v.isControl ? "—" : (
                      <span>
                        {editCount(v)} {editCount(v) === 1 ? "edit" : "edits"}, {goalCount(v)} {goalCount(v) === 1 ? "goal" : "goals"}{" "}
                        {editable && <button type="button" className="btn btn-secondary" onClick={() => openEditor(v.key)}>Edit variant<span className="visually-hidden"> {v.label} in the visual editor</span></button>}
                      </span>
                    )
                  ) : v.previewUrl ? (
                    <a href={v.previewUrl} target="_blank" rel="noreferrer">Preview<span className="visually-hidden"> {v.label} (opens in a new tab)</span></a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {test.status === "draft" && !isElement && variants.length < 2 && (
        <form className="card" onSubmit={addVariant} style={{ marginTop: 16 }}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="variant-label">Name for the challenger</label>
              <input id="variant-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} required />
              <span className="hint">WordPress makes a copy of the page. Edit the copy, then start the test.</span>
            </div>
            <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create challenger"}</button>
          </div>
        </form>
      )}
      {test.status === "draft" && isElement && !hasEdits && (
        <p className="hint" style={{ marginTop: 16 }}>Open the visual editor on the challenger, change something, and mark at least one goal. Then come back and start the test.</p>
      )}
      {test.status === "draft" && variants.length >= 2 && (
        <p style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy || (isElement && !hasEdits)} onClick={() => act("start", undefined, "The test is live.", "Could not start the test.")}><Icon name="play" />Start test</button>
        </p>
      )}

      {stats && (isLive || test.status === "archived" || test.status === "inconclusive") && (
        <>
          <h2>Results</h2>
          <StatsPanel stats={stats} variants={variants} confidenceThreshold={threshold} />
        </>
      )}

      {test.status !== "draft" && test.status !== "qa" && <HeatmapPanel testId={test.id} variants={variants} />}

      {decidable && (
        <div style={{ marginTop: 24 }}>
          <DecisionPanel
            key={stats?.latest?.winnerKey ?? "no-recommendation"} // re-initialise the default choice once the recommendation arrives
            testId={test.id}
            testType={test.type}
            variants={variants}
            recommendedKey={stats?.latest?.winnerKey ?? null}
            onDone={() => { setNotice("Decision applied. The test is archived."); load(); }}
          />
        </div>
      )}
    </div>
  );
}
