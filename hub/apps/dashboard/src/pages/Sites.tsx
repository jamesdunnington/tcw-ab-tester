import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { Icon } from "../components/Icon.js";
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
    api.get<{ sites: Site[] }>("/api/sites").then((res) => setSites(res.sites)).finally(() => setLoading(false));
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
      setError(err instanceof Error ? err.message : "Failed to add the site.");
    }
  }

  return (
    <div>
      <h1>Sites</h1>
      <p className="muted">Each WordPress site connects to this hub with its own key and secret.</p>

      {justCreated && (
        <div className="banner banner-warn" role="status">
          <Icon name="alert" />
          <div>
            <strong>{justCreated.site.displayName} added. Copy these into the WordPress plugin now.</strong> The secret is shown only this once.
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: "12px 0" }}>
              <dt>Hub URL</dt><dd style={{ margin: 0 }}><code>{window.location.origin}</code></dd>
              <dt>Site key</dt><dd style={{ margin: 0, wordBreak: "break-all" }}><code>{justCreated.credentials.siteKey}</code></dd>
              <dt>Site secret</dt><dd style={{ margin: 0, wordBreak: "break-all" }}><code>{justCreated.credentials.siteSecret}</code></dd>
            </dl>
            <button className="btn btn-secondary" onClick={() => setJustCreated(null)}>I have copied these</button>
          </div>
        </div>
      )}

      <form className="card" onSubmit={onCreate}>
        <h2 style={{ marginTop: 0 }}>Add a site</h2>
        <div className="form-row">
          <div className="field"><label htmlFor="domain">Domain</label><input id="domain" type="text" value={domain} onChange={(e) => setDomain(e.target.value)} required /><span className="hint">For example example.com</span></div>
          <div className="field"><label htmlFor="display-name">Display name</label><input id="display-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></div>
          <button type="submit" className="btn">Add site</button>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>

      <h2>Connected sites</h2>
      {loading ? (
        <div aria-busy="true" aria-label="Loading sites"><div className="skeleton" style={{ height: 120 }} /></div>
      ) : sites.length === 0 ? (
        <div className="card empty">No sites yet. Add one above to get started.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Connected sites</caption>
            <thead><tr><th>Site</th><th>Domain</th><th>Plugin</th><th>Last seen</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>{s.displayName}</td>
                  <td>{s.domain}</td>
                  <td>{s.pluginVersion ?? "Not connected yet"}</td>
                  <td>{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "Never"}</td>
                  <td><Link to={`/sites/${s.id}/tests`}>Tests<span className="visually-hidden"> for {s.displayName}</span></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
