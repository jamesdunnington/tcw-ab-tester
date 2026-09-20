import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Icon } from "../components/Icon.js";
import type { LibraryApplyResult, LibraryItemDetail, LibraryListItem, PostSummary, Site } from "../lib/types.js";

const lift = (n: number | null) => (n === null ? "n/a" : `${n >= 0 ? "+" : ""}${n}%`);

/** Every decided test, across all sites, kept for reuse (docs/PLAN.md section 10). */
export function LibraryPage() {
  const [items, setItems] = useState<LibraryListItem[] | null>(null);
  const [type, setType] = useState<"" | "page" | "element">("");
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (text.trim()) q.set("q", text.trim());
    if (tag.trim()) q.set("tag", tag.trim());
    const qs = q.toString();
    api
      .get<{ items: LibraryListItem[] }>(`/api/library${qs ? `?${qs}` : ""}`)
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the library."));
  }, [type, text, tag]);

  useEffect(load, [load]);

  return (
    <div>
      <h1>Library</h1>
      <p className="muted">Every decided test is kept here, including ones whose copy was deleted. Reuse a result on another site as a new test or a draft. Audiences differ, so treat a past winner as a hypothesis.</p>

      <form className="heat-toolbar" onSubmit={(e: FormEvent) => e.preventDefault()} role="search">
        <div className="field">
          <label htmlFor="lib-type">Type</label>
          <select id="lib-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="">All</option>
            <option value="element">Element tests</option>
            <option value="page">Page tests</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="lib-q">Name contains</label>
          <input id="lib-q" type="text" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lib-tag">Tag</label>
          <input id="lib-tag" type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="copy, style, removal…" />
        </div>
      </form>

      {error && <div className="banner banner-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>}
      {!items && !error && <div className="skeleton" style={{ height: 120 }} aria-busy="true" aria-label="Loading library" />}
      {items && items.length === 0 && <div className="card empty">Nothing here yet. A test appears in the library once you decide it.</div>}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Decided tests</caption>
            <thead>
              <tr><th>Test</th><th>Type</th><th>Outcome</th><th className="num">Lift</th><th className="num">Sessions</th><th>Tags</th><th><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}<br /><span className="muted small">{it.sourceDomain} · {new Date(it.decidedAt).toLocaleDateString()}</span></td>
                  <td>{it.type === "element" ? "Element" : "Page"}</td>
                  <td>{it.outcome === "applied_variant" ? <span className="badge badge-success"><Icon name="trophy" />{it.winnerLabel} won</span> : <span className="badge badge-neutral"><Icon name="archive" />Original kept</span>}</td>
                  <td className="num">{lift(it.liftPct)}</td>
                  <td className="num">{it.sessions}</td>
                  <td>{it.tags.join(", ")}</td>
                  <td>
                    <button type="button" className="btn btn-secondary" disabled={!it.reusable} onClick={() => setSelected(it.id)} aria-pressed={selected === it.id}>
                      Reuse<span className="visually-hidden"> {it.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ReusePanel key={selected} itemId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ReusePanel({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [item, setItem] = useState<LibraryItemDetail | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [search, setSearch] = useState("");
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [postId, setPostId] = useState<number | null>(null);
  const [mode, setMode] = useState<"test" | "permanent">("test");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LibraryApplyResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.get<LibraryItemDetail>(`/api/library/${itemId}`).then(setItem).catch((e) => setError(e instanceof Error ? e.message : "Could not load this item."));
    api.get<{ sites: Site[] }>("/api/sites").then((r) => setSites(r.sites));
  }, [itemId]);

  async function findPosts(e: FormEvent) {
    e.preventDefault();
    if (!siteId || !search.trim()) return;
    setError(null);
    try {
      setPosts((await api.get<{ posts: PostSummary[] }>(`/api/sites/${siteId}/posts?search=${encodeURIComponent(search.trim())}`)).posts);
    } catch {
      setError("Could not search that site. Is the plugin connected?");
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    setConfirming(false);
    const element = item?.type === "element";
    try {
      setDone(await api.post<LibraryApplyResult>(`/api/library/${itemId}/apply`, { targetSiteId: siteId, wpPostId: element ? postId ?? undefined : undefined, mode: element ? mode : undefined }));
    } catch (e) {
      setError(e instanceof Error ? `Could not apply it (${e.message}).` : "Could not apply it.");
    } finally {
      setBusy(false);
    }
  }

  if (!item) return <div className="card" style={{ marginTop: 16 }}>{error ? <div role="alert">{error}</div> : <div className="skeleton" style={{ height: 80 }} aria-busy="true" />}</div>;

  const isElement = item.type === "element";
  const canApply = !!siteId && (!isElement || postId !== null) && !busy;
  const edits = (item.changeOps ?? []).filter((o) => o.op !== "goal");
  const source = item.pages.find((p) => p.key === item.winnerKey) ?? item.pages[0];

  return (
    <section className="card" style={{ marginTop: 24 }} aria-labelledby="reuse-heading">
      <h2 id="reuse-heading" style={{ marginTop: 0 }}>Reuse “{item.name}”</h2>
      {isElement ? (
        <p className="muted small">{edits.length} {edits.length === 1 ? "change" : "changes"}: {edits.map((o) => `${o.op} on ${o.selector}`).join("; ") || "none"}</p>
      ) : (
        <p className="muted small">A draft post is created from “{source?.title ?? "the winning page"}”. It is never published automatically.</p>
      )}

      {done ? (
        <div className="banner banner-success" role="status">
          <Icon name="check" />
          <div>
            {done.kind === "element_test" && <>A draft test was created with the change loaded. <Link to={`/tests/${done.testId}`}>Open the test</Link>{done.editorUrl && <> or <a href={done.editorUrl} target="_blank" rel="noreferrer">check the selectors in the editor<span className="visually-hidden"> (opens in a new tab)</span></a></>}. Selectors from another site may need re-mapping.</>}
            {done.kind === "permanent_rule" && <>The change is now live on that page for every visitor.</>}
            {done.kind === "draft_post" && <>A draft was created on the target site. <a href={done.editUrl} target="_blank" rel="noreferrer">Review it in WordPress<span className="visually-hidden"> (opens in a new tab)</span></a>.</>}
          </div>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="reuse-site">Apply to site</label>
            <select id="reuse-site" value={siteId} onChange={(e) => { setSiteId(e.target.value); setPosts([]); setPostId(null); }}>
              <option value="">Choose a site…</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.domain})</option>)}
            </select>
          </div>

          {isElement && siteId && (
            <>
              <form className="form-row" onSubmit={findPosts} style={{ marginBottom: 12 }}>
                <div className="field">
                  <label htmlFor="reuse-search">Find the page to test on</label>
                  <input id="reuse-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Part of the page title" />
                </div>
                <button className="btn btn-secondary" type="submit">Search</button>
              </form>
              {posts.length > 0 && (
                <fieldset className="field" style={{ border: 0, padding: 0 }}>
                  <legend>Pick one</legend>
                  {posts.map((p) => (
                    <label className="choice" key={p.id}>
                      <input type="radio" name="reuse-post" checked={postId === p.id} onChange={() => setPostId(p.id)} />
                      <span>{p.title || "(untitled)"} <span className="muted small">#{p.id} · {p.status}</span></span>
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset className="field" style={{ border: 0, padding: 0 }}>
                <legend>How</legend>
                <label className="choice">
                  <input type="radio" name="reuse-mode" checked={mode === "test"} onChange={() => setMode("test")} />
                  <span>Start it as a new test (recommended)<br /><span className="hint">Creates a draft test with the change loaded. Nothing goes live until you start it.</span></span>
                </label>
                <label className="choice">
                  <input type="radio" name="reuse-mode" checked={mode === "permanent"} disabled={item.outcome !== "applied_variant"} onChange={() => setMode("permanent")} />
                  <span>Make it permanent now<br /><span className="hint">{item.outcome === "applied_variant" ? "Goes live for every visitor with no test. Only sensible if the audiences are alike." : "Only changes that won can be made permanent."}</span></span>
                </label>
              </fieldset>
            </>
          )}

          {error && <div className="banner banner-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>}
          <div className="form-row" style={{ alignItems: "center" }}>
            <button type="button" className={`btn ${isElement && mode === "permanent" ? "btn-danger" : ""}`} disabled={!canApply} onClick={() => (isElement && mode === "permanent" ? setConfirming(true) : void apply())}>
              {busy ? "Working…" : isElement ? (mode === "permanent" ? "Make it permanent" : "Create draft test") : "Create draft post"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </>
      )}
      <ConfirmDialog open={confirming} title="Make this change permanent?" confirmLabel="Make it permanent" danger busy={busy} onConfirm={() => void apply()} onCancel={() => setConfirming(false)}>
        <p>The change goes live now for every visitor of the chosen page, with no test and no tracking. Audiences differ between sites, so a change that won elsewhere may not win here. Removing it later means editing the plugin's saved rules.</p>
      </ConfirmDialog>
    </section>
  );
}
