import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { StatusBadge } from "../components/StatusBadge.js";
import type { Test } from "../lib/types.js";

export function TestsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [wpPostId, setWpPostId] = useState("");
  const [trafficSplit, setTrafficSplit] = useState(50);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    if (!siteId) return;
    setLoading(true);
    api.get<{ tests: Test[] }>(`/api/tests?siteId=${siteId}`).then((res) => setTests(res.tests)).finally(() => setLoading(false));
  }
  useEffect(refresh, [siteId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.post("/api/tests", { siteId, wpPostId: Number(wpPostId), trafficSplit });
      setWpPostId("");
      refresh();
    } catch {
      setError("Could not create the test. Check the post ID exists on that site and that the plugin is connected.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <Link to="/sites" className="back-link">← All sites</Link>
      <h1>Tests</h1>

      <form className="card" onSubmit={onCreate}>
        <h2 style={{ marginTop: 0 }}>New page or post test</h2>
        <div className="form-row">
          <div className="field">
            <label htmlFor="post-id">WordPress post or page ID</label>
            <input id="post-id" type="number" min={1} value={wpPostId} onChange={(e) => setWpPostId(e.target.value)} required aria-describedby="post-id-hint" />
            <span id="post-id-hint" className="hint">Shown in the address bar when editing: post.php?post=123</span>
          </div>
          <div className="field">
            <label htmlFor="split">Traffic to variant B (%)</label>
            <input id="split" type="number" min={1} max={99} value={trafficSplit} onChange={(e) => setTrafficSplit(Number(e.target.value))} required />
          </div>
          <button type="submit" className="btn" disabled={creating}>{creating ? "Creating…" : "Create test"}</button>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>

      <h2>All tests</h2>
      {loading ? (
        <div aria-busy="true" aria-label="Loading tests"><div className="skeleton" style={{ height: 120 }} /></div>
      ) : tests.length === 0 ? (
        <div className="card empty">No tests yet for this site. Create one above.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Tests for this site</caption>
            <thead><tr><th>Name</th><th>Status</th><th>WordPress post</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td><a href={t.wpPermalink} target="_blank" rel="noreferrer">#{t.wpPostId}<span className="visually-hidden"> (opens in a new tab)</span></a></td>
                  <td><Link to={`/tests/${t.id}`}>Open<span className="visually-hidden"> {t.name}</span></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
