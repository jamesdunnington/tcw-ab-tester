import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Test } from "../lib/types.js";

export function TestsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [wpPostId, setWpPostId] = useState("");
  const [trafficSplit, setTrafficSplit] = useState(50);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    if (!siteId) return;
    setLoading(true);
    api
      .get<{ tests: Test[] }>(`/api/tests?siteId=${siteId}`)
      .then((res) => setTests(res.tests))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [siteId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/tests", {
        siteId,
        wpPostId: Number(wpPostId),
        trafficSplit,
      });
      setWpPostId("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create test. Check the post ID and that the site is connected.");
    }
  }

  return (
    <div>
      <p><Link to="/sites">← Sites</Link></p>
      <h1>Tests</h1>

      <form className="inline-form" onSubmit={onCreate}>
        <input
          placeholder="WordPress post/page ID"
          value={wpPostId}
          onChange={(e) => setWpPostId(e.target.value)}
          required
        />
        <label className="split-label">
          Split (% to variant B)
          <input
            type="number"
            min={1}
            max={99}
            value={trafficSplit}
            onChange={(e) => setTrafficSplit(Number(e.target.value))}
          />
        </label>
        <button type="submit">Create test</button>
      </form>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : tests.length === 0 ? (
        <p>No tests yet for this site.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>WP Post</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td><span className={`status status-${t.status}`}>{t.status}</span></td>
                <td>
                  <a href={t.wpPermalink} target="_blank" rel="noreferrer">#{t.wpPostId}</a>
                </td>
                <td><Link to={`/tests/${t.id}`}>Manage →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
