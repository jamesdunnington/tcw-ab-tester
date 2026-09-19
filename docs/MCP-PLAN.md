# Claude Desktop connector (remote MCP) - design

Goal: after the plugin is installed on a WordPress site, the owner sets up and
runs A/B tests by chatting in Claude Desktop (or a Claude Project). Claude talks
to the hub through a **remote MCP connector**: a Streamable HTTP URL secured
with OAuth, added in Claude Desktop as a custom connector. Chosen by the owner;
not in the original PLAN.md.

## Requirements the owner set
- Transport: **Streamable HTTP** at `https://mcptest.thecontentwarrior.work/mcp`.
- Hostnames (owner's choice): hub + dashboard + `/ingest` on `https://test.thecontentwarrior.work`; the MCP connector on its own host `https://mcptest.thecontentwarrior.work`. The WordPress plugin is pointed at the hub host.
- Auth: **OAuth** (no password or long-lived secret pasted into config).
- Safety: Claude may **draft freely**; going live needs an explicit yes in chat.

## Hard prerequisite
Remote connectors are reached from Anthropic's side, so the hub must be on a
**public HTTPS URL** (the VPS + Caddy). `localhost` will not work; a tunnel
(cloudflared/ngrok) is the only way to try it before the VPS is up.

## Architecture
New workspace `hub/apps/mcp` (Node, `@modelcontextprotocol/sdk` 1.30), its own
container behind Caddy. Caddy sends the whole `mcptest.thecontentwarrior.work` host to it
(`/mcp`, `/authorize`, `/token`, `/register`, `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`); it needs its own DNS record and certificate.

- **Authorization server:** SDK `mcpAuthRouter` + a custom `OAuthServerProvider`
  backed by hub tables (additive migration): `oauth_clients` (dynamic client
  registration, RFC 7591), `oauth_codes` (PKCE, single use, 10 min),
  `oauth_tokens` (access ~1h + refresh, **stored hashed**, `user_id`, `scopes`).
- **Login + consent:** the hub and MCP are on different hostnames, so the
  dashboard session cookie is NOT shared (do not widen the cookie to the parent
  domain just for this). `/authorize` shows its own login form that verifies the
  same hub admin credentials (argon2, shared `users` table, plus TOTP if enabled),
  rate-limited and audit-logged, then a consent screen listing the scopes.
- **Resource server:** `/mcp` validates the bearer token, then calls the same
  code paths as the dashboard. Preferred: extract the route logic in
  `hub/apps/api` into shared functions (as was done for `saveVariantOps`) and
  call them in-process from the MCP app, rather than duplicating or looping over
  HTTP. Every call is written to the audit log with the OAuth client as actor.
- **Scopes:** `hub:read`, `hub:draft`, `hub:live`. `hub:live` is a separate
  checkbox on the consent screen, off by default.

## Tools (all inputs validated with the existing zod schemas)
| Tool | Scope | Notes |
|---|---|---|
| `list_sites`, `list_tests`, `get_test`, `get_results` | read | results include the stats engine's recommendation and why a winner is or isn't declared |
| `find_posts` | read | search a site's posts/pages by title (new signed WP route; today only fetch-by-id exists) |
| `inspect_page` | read | hub fetches the post's permalink **server-side, only on that site's own domain (SSRF guard)** and returns a trimmed DOM outline with candidate selectors from `buildSelector`, so Claude can choose real selectors without seeing the page |
| `create_element_test`, `create_page_test` | draft | draft status only |
| `set_variant_ops` | draft | `changeOpsSchema`; returns validation errors verbatim so Claude can fix them |
| `get_editor_link` | draft | the signed visual-editor URL, to eyeball or fine-tune |
| `start_test`, `stop_test` | live | requires `confirm: true` |
| `apply_winner` | live | requires `confirm: true`, `chosenVariantKey`, `deleteRedundant`, and a `reason` if overriding the recommendation; annotated `destructiveHint` |

Honest limit: the server cannot tell whether the human really agreed. The
guards are the separate `hub:live` grant, `confirm: true`, tool annotations
(Claude Desktop shows an approval prompt per call), and the audit log.

## Build order
1. Bump zod to >=3.25 across the workspace (SDK peer dependency); run CI.
2. Migration + token/client/code stores, with tests for PKCE, single-use codes,
   expiry, hashed storage, refresh rotation.
3. `hub/apps/mcp` skeleton: `/mcp` with `list_sites` only, OAuth working end to
   end against the MCP Inspector (`npx @modelcontextprotocol/inspector`).
4. Read tools, then draft tools, then live tools.
5. Caddy routes, compose service, README section: how to add the connector
   (Claude Desktop > Settings > Connectors > Add custom connector > URL).
6. Verify the real flow in Claude Desktop through a public URL.

## Risks to check early
- Claude Desktop/claude.ai OAuth quirks (dynamic registration, callback URL
  `https://claude.ai/api/mcp/auth_callback`); read current docs before coding.
- The SDK's auth handlers are Express; run the MCP app on Express, do not try to
  graft them onto Fastify.
- Rate-limit `/register`, `/token` and `/authorize`; log failures.
