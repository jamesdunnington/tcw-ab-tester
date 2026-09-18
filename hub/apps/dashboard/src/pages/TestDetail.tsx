import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Test, TestResults, Variant } from "../lib/types.js";

export function TestDetailPage() {
  const { testId } = useParams<{ testId: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [results, setResults] = useState<TestResults | null>(null);
  const [label, setLabel] = useState("B (variant)");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    if (!testId) return;
    api.get<{ test: Test; variants: Variant[] }>(`/api/tests/${testId}`).then((res) => {
      setTest(res.test);
      setVariants(res.variants);
    });
    api
      .get<TestResults>(`/api/tests/${testId}/results`)
      .then(setResults)
      .catch(() => setResults(null));
  }

  useEffect(refresh, [testId]);

  async function addVariant() {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/tests/${testId}/variants`, { label });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create variant — is the site connected and reachable?");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/tests/${testId}/start`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start the test.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await api.post(`/api/tests/${testId}/stop`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!test) return <p>Loading…</p>;

  return (
    <div>
      <p><Link to={`/sites/${test.siteId}/tests`}>← Tests</Link></p>
      <h1>{test.name}</h1>
      <p>
        Status: <span className={`status status-${test.status}`}>{test.status}</span>
        {" · "}
        <a href={test.wpPermalink} target="_blank" rel="noreferrer">View original post</a>
      </p>

      {error && <p className="error">{error}</p>}

      <h2>Variants</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Label</th>
            <th>Traffic</th>
            <th>Control?</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id}>
              <td>{v.key}</td>
              <td>{v.label}</td>
              <td>{v.trafficWeight}%</td>
              <td>{v.isControl ? "Yes (original)" : "No"}</td>
              <td>{v.previewUrl ? <a href={v.previewUrl} target="_blank" rel="noreferrer">Preview</a> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {test.status === "draft" && variants.length < 2 && (
        <div className="inline-form">
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
          <button onClick={addVariant} disabled={busy}>Create variant B on WordPress</button>
        </div>
      )}

      {test.status === "draft" && variants.length >= 2 && (
        <button onClick={start} disabled={busy}>Start test</button>
      )}

      {test.status === "running" && (
        <button onClick={stop} disabled={busy}>Stop test</button>
      )}

      {results && (
        <>
          <h2>Results</h2>
          <p className="muted">{results.note}</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>Sessions</th>
                <th>Avg. active time</th>
                <th>Avg. scroll depth</th>
                <th>Click rate</th>
                <th>Rage clicks</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((r) => (
                <tr key={r.variantId}>
                  <td>{r.label}{r.isControl ? " (A)" : ""}</td>
                  <td>{r.sessions}</td>
                  <td>{r.avgActiveSeconds}s</td>
                  <td>{r.avgScrollDepthPct}%</td>
                  <td>{r.clickRate}%</td>
                  <td>{r.rageClicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
