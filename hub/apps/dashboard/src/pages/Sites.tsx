import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Site, SiteCredentials } from "../lib/types.js";

export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ site: Site; credentials: SiteCredentials } | null>(null);

  function refresh() {
    setLoading(true);
    api
      .get<{ sites: Site[] }>("/api/sites")
      .then((res) => setSites(res.sites))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ site: Site; credentials: SiteCredentials }>("/api/sites", { domain, displayName });
      setJustCreated(res);
      setDomain("");
      setDisplayName("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create site.");
    }
  }

  return (
    <div>
      <h1>Sites</h1>

      {justCreated && (
        <div className="callout">
          <strong>{justCreated.site.displayName} connected.</strong> Paste these into the WordPress plugin's
          settings page now — the secret is shown only this once.
          <dl>
            <dt>Hub URL</dt>
            <dd><code>{window.location.origin}</code></dd>
            <dt>Site Key</dt>
            <dd><code>{justCreated.credentials.siteKey}</code></dd>
            <dt>Site Secret</dt>
            <dd><code>{justCreated.credentials.siteSecret}</code></dd>
          </dl>
          <button onClick={() => setJustCreated(null)}>I've copied these</button>
        </div>
      )}

      <form className="inline-form" onSubmit={onCreate}>
        <input placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <button type="submit">Add site</button>
      </form>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : sites.length === 0 ? (
        <p>No sites connected yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Domain</th>
              <th>Plugin</th>
              <th>Last seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td>{s.displayName}</td>
                <td>{s.domain}</td>
                <td>{s.pluginVersion ?? "not connected yet"}</td>
                <td>{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "never"}</td>
                <td>
                  <Link to={`/sites/${s.id}/tests`}>View tests →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
