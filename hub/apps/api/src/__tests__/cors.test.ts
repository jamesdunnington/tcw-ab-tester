import { describe, it, expect } from "vitest";
import { corsFor } from "../lib/cors.js";

const dash = ["https://hub.example.com"];

describe("corsFor", () => {
  it("lets any site origin call /ingest, without credentials", () => {
    const c = corsFor("/ingest", dash);
    expect(c.origin).toBe(true);
    expect(c.credentials).toBe(false);
    expect(c.allowedHeaders).toContain("x-tcw-site-key");
  });

  it("lets any site origin call /editor/* with a bearer header, without credentials", () => {
    const c = corsFor("/editor/ops", dash);
    expect(c.origin).toBe(true);
    expect(c.credentials).toBe(false);
    expect(c.allowedHeaders).toContain("authorization");
    expect(c.methods).toContain("PUT");
  });

  it("keeps the dashboard API restricted to the dashboard origins, with cookies", () => {
    const c = corsFor("/api/tests", dash);
    expect(c.origin).toEqual(dash);
    expect(c.credentials).toBe(true);
  });

  it("blocks cross-origin access to the dashboard API when no origins are configured", () => {
    expect(corsFor("/api/tests", []).origin).toBe(false);
  });

  it("does not open look-alike prefixes", () => {
    expect(corsFor("/ingestion", dash).credentials).toBe(true);
    expect(corsFor("/editorial/x", dash).credentials).toBe(true);
  });
});
