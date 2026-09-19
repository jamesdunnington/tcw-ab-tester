/**
 * Per-route CORS policy. The dashboard is a fixed set of origins and uses the
 * session cookie. Two groups of routes are called from the customer's own
 * WordPress origin, which the hub can't list up front, so they accept any
 * origin but never with credentials:
 *   - /ingest: the browser tracker (validated by site key + origin check in the route)
 *   - /editor/*: the visual editor, authenticated by its signed bearer token
 * Without this, the tracker's JSON + x-tcw-site-key fetch and sendBeacon would
 * fail their CORS preflight in a real browser.
 */
export interface CorsDecision {
  origin: boolean | string[];
  credentials: boolean;
  methods?: string[];
  allowedHeaders?: string[];
}

const isSitePath = (p: string) => p === "/ingest" || p.startsWith("/editor/");

export function corsFor(pathname: string, dashboardOrigins: string[]): CorsDecision {
  if (isSitePath(pathname)) {
    return {
      origin: true,
      credentials: false,
      methods: ["GET", "POST", "PUT", "OPTIONS"],
      allowedHeaders: ["content-type", "authorization", "x-tcw-site-key"],
    };
  }
  return { origin: dashboardOrigins.length > 0 ? dashboardOrigins : false, credentials: true };
}
