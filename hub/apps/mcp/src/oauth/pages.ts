const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const CSS = `
:root{--bg:#f7f8fa;--card:#fff;--text:#14181f;--muted:#5b6472;--line:#d9dde4;--primary:#1d4ed8;--danger:#b42318;--warn:#7a4a00;--warn-bg:#fff4e0}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--text:#e6edf3;--muted:#9aa4b2;--line:#2b323c;--primary:#6ea8fe;--danger:#ff8b81;--warn:#f0c674;--warn-bg:#2a2210}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:1.25rem;margin:0 0 4px}p{margin:8px 0}.muted{color:var(--muted);font-size:.9rem}
label{display:block;font-weight:600;margin:14px 0 4px}input[type=email],input[type=password]{width:100%;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.scope{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);font-weight:400;margin:0}.scope:first-of-type{border-top:0}.scope input{width:20px;height:20px;margin-top:3px;accent-color:var(--primary)}
.scope b{display:block}.live{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:10px 12px;margin-top:6px}
.err{color:var(--danger);font-weight:600}.row{display:flex;gap:12px;margin-top:20px}
button{min-height:44px;padding:8px 18px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--primary)}
.go{background:var(--primary);color:#fff;flex:1}.no{background:transparent;color:var(--primary)}
@media (prefers-color-scheme:dark){.go{color:#0d1117}}
`;

const SCOPE_INFO: Record<string, { title: string; body: string }> = {
  "hub:read": { title: "Read your tests and results", body: "See sites, tests, statistics, analytics and page structure." },
  "hub:draft": { title: "Draft tests", body: "Create draft tests and edit variants. Nothing goes live." },
  "hub:live": { title: "Start, stop and decide tests", body: "Go live, stop a test, or apply a winner (which can change or delete pages on your site). Claude still has to be told to confirm each time." },
};

export function consentPage(opts: { clientName: string; redirectHost: string; pending: string; requested: string[]; error?: string; email?: string }): string {
  const wantsLive = opts.requested.includes("hub:live");
  const scopeRow = (scope: string, checked: boolean, locked: boolean) => `
    <label class="scope"><input type="checkbox" name="scope" value="${scope}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""}>
      <span><b>${escapeHtml(SCOPE_INFO[scope].title)}</b><span class="muted">${escapeHtml(SCOPE_INFO[scope].body)}</span></span></label>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect ${escapeHtml(opts.clientName)}</title><meta name="robots" content="noindex"><style>${CSS}</style></head>
<body><main>
<h1>Connect ${escapeHtml(opts.clientName)}</h1>
<p class="muted">${escapeHtml(opts.clientName)} wants to use your TCW A/B Tester hub. After you approve, it returns to <b>${escapeHtml(opts.redirectHost)}</b>. Only continue if you started this from Claude.</p>
${opts.error ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>` : ""}
<form method="post" action="/oauth/consent" autocomplete="on">
<input type="hidden" name="pending" value="${escapeHtml(opts.pending)}">
<label for="email">Hub admin email</label><input id="email" name="email" type="email" required autocomplete="username" value="${escapeHtml(opts.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
<fieldset style="border:0;padding:0;margin:18px 0 0"><legend style="font-weight:600;padding:0">Allow</legend>
${scopeRow("hub:read", true, true)}
${scopeRow("hub:draft", true, false)}
${scopeRow("hub:live", false, false)}
${wantsLive ? "" : '<p class="muted">Claude did not ask to go live, so tick this only if you want that.</p>'}
<p class="live" role="note">Leave "Start, stop and decide" unticked to make sure nothing can go live or be deleted from chat.</p>
</fieldset>
<div class="row"><button class="go" type="submit" name="decision" value="approve">Approve</button><button class="no" type="submit" name="decision" value="deny" formnovalidate>Deny</button></div>
</form></main></body></html>`;
}

export function messagePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex"><style>${CSS}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
}
