/**
 * A site's `domain` does two jobs: it is where the hub calls WordPress (server to server), and it is the
 * Origin a visitor's browser must send to /ingest. In production both are the site's public address. These
 * helpers keep the two uses from breaking on cosmetic differences (a trailing slash, www, http vs https).
 */

/** "https://host[:port]" (lowercase, no path or query), or null when the input is not a usable http(s) address. */
export function normalizeSiteDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null; // "null" is what sandboxed pages send as Origin
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

const bare = (hostname: string) => hostname.replace(/^www\./, "");

/**
 * Whether a browser's Origin (or Referer) belongs to the site. Compares host and port, and ignores the
 * scheme and a leading "www.". It is exact: "example.com.evil.test" does not match "example.com".
 * Not a strong boundary (the header is client-supplied); it filters drive-by noise.
 */
export function originMatchesSite(origin: string, domain: string): boolean {
  const seen = normalizeSiteDomain(origin);
  const site = normalizeSiteDomain(domain);
  if (!seen || !site) return false;
  const a = new URL(seen);
  const b = new URL(site);
  return bare(a.hostname) === bare(b.hostname) && a.port === b.port;
}
