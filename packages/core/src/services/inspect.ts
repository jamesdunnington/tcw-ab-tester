import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { parse, type HTMLElement } from "node-html-parser";
import { sites } from "@tcw/db";
import { getDb } from "../context.js";
import { fetchPostInfo } from "../wp-client.js";
import { fail, ok, type ServiceResult } from "../result.js";

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_OUTLINE_NODES = 160;
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "template", "head", "iframe", "link", "meta"]);

/** True for loopback, RFC1918, link-local (incl. cloud metadata 169.254.169.254), CGNAT and unique-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
    return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function hostOf(domain: string): string {
  return new URL(/^https?:\/\//.test(domain) ? domain : `https://${domain}`).hostname.toLowerCase();
}

/**
 * SSRF guard for the server-side page fetch: http(s) only, the host must be exactly the registered
 * site's host (so a compromised or tricked caller cannot point the hub at anything else), and unless the
 * operator opted in (local dev), it must not resolve to a private or link-local address.
 */
export async function assertSafeFetchUrl(rawUrl: string, siteDomain: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported_scheme");
  if (url.username || url.password) throw new Error("credentials_in_url");
  if (url.hostname.toLowerCase() !== hostOf(siteDomain)) throw new Error("host_not_the_registered_site");
  if (!allowPrivate) {
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("private_address_blocked");
  }
  return url;
}

async function fetchHtml(startUrl: string, siteDomain: string, allowPrivate: boolean): Promise<string> {
  let url = await assertSafeFetchUrl(startUrl, siteDomain, allowPrivate);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html", "user-agent": "TCW-AB-Tester-Inspector/1.0" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertSafeFetchUrl(new URL(res.headers.get("location") as string, url).toString(), siteDomain, allowPrivate);
      continue;
    }
    if (!res.ok) throw new Error(`page_returned_${res.status}`);
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) throw new Error("not_html");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("empty_body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("page_too_large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("too_many_redirects");
}

const SAFE_TOKEN = /^[A-Za-z][\w-]{0,40}$/;
/** Classes that look generated (hashes, utility soup) make brittle selectors. */
const looksGenerated = (c: string) => (c.match(/\d/g) ?? []).length > 3 || c.length > 32;

function nthOfType(el: HTMLElement): number {
  const siblings = el.parentNode?.childNodes.filter((n) => (n as HTMLElement).tagName === el.tagName) ?? [];
  return siblings.indexOf(el) + 1;
}

/** id first (if unique), else a short path of tag[.class]:nth-of-type steps from the nearest id'd ancestor. Verified unique. */
export function selectorFor(el: HTMLElement, root: HTMLElement): string | null {
  const id = el.getAttribute("id");
  if (id && SAFE_TOKEN.test(id) && root.querySelectorAll(`#${id}`).length === 1) return `#${id}`;

  const steps: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node.tagName && node.tagName.toLowerCase() !== "body") {
    const nodeId = node.getAttribute("id");
    if (nodeId && SAFE_TOKEN.test(nodeId) && root.querySelectorAll(`#${nodeId}`).length === 1) {
      steps.unshift(`#${nodeId}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const cls = node.classList.value.find((c) => SAFE_TOKEN.test(c) && !looksGenerated(c));
    steps.unshift(`${tag}${cls ? `.${cls}` : ""}:nth-of-type(${nthOfType(node)})`);
    node = node.parentNode as HTMLElement | null;
    if (steps.length >= 6) break;
  }
  const selector = steps.join(" > ");
  try {
    return root.querySelectorAll(selector).length === 1 ? selector : null;
  } catch {
    return null;
  }
}

export interface OutlineNode {
  selector: string;
  tag: string;
  text: string;
  depth: number;
  href?: string;
  src?: string;
  classes?: string[];
}

const INTERESTING = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "a", "button", "img", "form", "input", "label", "nav", "header", "footer", "section", "p", "li"]);

/** Trimmed, selector-annotated outline of the page body. Pure, so it can be tested without a network. */
export function buildOutline(html: string): { title: string; nodes: OutlineNode[]; truncated: boolean } {
  const root = parse(html);
  const body = root.querySelector("body") ?? root;
  const nodes: OutlineNode[] = [];
  let truncated = false;

  const visit = (el: HTMLElement, depth: number) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag || SKIP_TAGS.has(tag)) return;
    const id = el.getAttribute("id");
    if (INTERESTING.has(tag) || (id && SAFE_TOKEN.test(id))) {
      if (nodes.length >= MAX_OUTLINE_NODES) {
        truncated = true;
        return;
      }
      const selector = selectorFor(el, body);
      const text = el.text.replace(/\s+/g, " ").trim();
      // Containers with no text of their own and no id add noise; keep them only when they hold something to edit.
      if (selector && (text || tag === "img" || tag === "input" || tag === "form")) {
        const cls = el.classList.value.filter((c) => SAFE_TOKEN.test(c) && !looksGenerated(c)).slice(0, 4);
        nodes.push({
          selector,
          tag,
          text: text.slice(0, 90),
          depth,
          ...(el.getAttribute("href") ? { href: (el.getAttribute("href") as string).slice(0, 120) } : {}),
          ...(el.getAttribute("src") ? { src: (el.getAttribute("src") as string).slice(0, 120) } : {}),
          ...(cls.length ? { classes: cls } : {}),
        });
      }
    }
    for (const child of el.childNodes) if ((child as HTMLElement).tagName) visit(child as HTMLElement, depth + 1);
  };
  visit(body, 0);
  return { title: root.querySelector("title")?.text.trim() ?? "", nodes, truncated };
}

/** How many elements a selector matches on this HTML, so Claude can check a selector before saving it into a variant. */
export function checkSelectors(html: string, selectors: string[]): Array<{ selector: string; matches: number; sampleText: string; error?: string }> {
  const root = parse(html);
  return selectors.slice(0, 20).map((selector) => {
    try {
      const found = root.querySelectorAll(selector);
      return { selector, matches: found.length, sampleText: (found[0]?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 90) };
    } catch (err) {
      return { selector, matches: 0, sampleText: "", error: err instanceof Error ? err.message : "invalid_selector" };
    }
  });
}

/**
 * Fetches a post's permalink on the site's own domain and returns an outline with candidate selectors.
 * The permalink comes from WordPress itself (signed call), never from the caller.
 */
export async function inspectPage(siteId: string, wpPostId: number, opts: { selectors?: string[]; allowPrivate?: boolean } = {}): Promise<ServiceResult<Record<string, unknown>>> {
  const [site] = await getDb().select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) return fail(404, "site_not_found");
  const post = await fetchPostInfo(site, wpPostId);

  let html: string;
  try {
    html = await fetchHtml(post.permalink, site.domain, opts.allowPrivate ?? false);
  } catch (err) {
    return fail(502, "page_fetch_failed", err instanceof Error ? err.message : String(err));
  }

  const outline = buildOutline(html);
  return ok({
    post: { id: post.id, type: post.type, title: post.title, permalink: post.permalink },
    pageTitle: outline.title,
    outline: outline.nodes,
    outlineTruncated: outline.truncated,
    ...(opts.selectors?.length ? { selectorChecks: checkSelectors(html, opts.selectors) } : {}),
    notes: [
      "This is the server-rendered HTML. Content a theme or page builder adds with JavaScript is not in it, and selectors for it cannot be verified here; use the visual editor for those.",
      "Prefer selectors that match exactly 1 element. Selectors starting with # are the most stable.",
    ],
  });
}
