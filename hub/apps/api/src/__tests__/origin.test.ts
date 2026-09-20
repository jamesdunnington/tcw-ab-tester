import { describe, expect, it } from "vitest";
import { normalizeSiteDomain, originMatchesSite } from "../lib/origin.js";

describe("normalizeSiteDomain", () => {
  it("reduces what people type to scheme://host[:port]", () => {
    expect(normalizeSiteDomain("example.com")).toBe("https://example.com");
    expect(normalizeSiteDomain("https://Example.com/")).toBe("https://example.com");
    expect(normalizeSiteDomain("https://example.com/blog/?a=1#x")).toBe("https://example.com");
    expect(normalizeSiteDomain("  http://host.docker.internal:8080/wp-admin ")).toBe("http://host.docker.internal:8080");
    expect(normalizeSiteDomain("https://example.com:443")).toBe("https://example.com");
  });

  it("refuses input that is not a usable web address", () => {
    for (const bad of ["", "   ", "null", "ftp://example.com", "javascript:alert(1)", "https://", "not a domain"]) {
      expect(normalizeSiteDomain(bad), bad).toBeNull();
    }
  });
});

describe("originMatchesSite", () => {
  it("accepts the site's own address however it was typed", () => {
    expect(originMatchesSite("https://example.com", "example.com")).toBe(true);
    expect(originMatchesSite("https://example.com", "example.com/")).toBe(true); // a trailing slash used to 403 every visitor
    expect(originMatchesSite("https://example.com/some/page?x=1", "https://example.com")).toBe(true); // a Referer
    expect(originMatchesSite("https://EXAMPLE.com", "https://example.com")).toBe(true);
  });

  it("treats www and the bare name as the same site, and ignores http vs https", () => {
    expect(originMatchesSite("https://www.example.com", "example.com")).toBe(true);
    expect(originMatchesSite("https://example.com", "https://www.example.com")).toBe(true);
    expect(originMatchesSite("http://example.com", "https://example.com")).toBe(true);
  });

  it("matches the port when the site uses one", () => {
    expect(originMatchesSite("http://host.docker.internal:8080", "http://host.docker.internal:8080")).toBe(true);
    expect(originMatchesSite("http://localhost:8080", "http://host.docker.internal:8080")).toBe(false); // different names: the old Docker trap
    expect(originMatchesSite("http://host.docker.internal:9999", "http://host.docker.internal:8080")).toBe(false);
  });

  it("rejects other sites, including look-alikes the old substring check let through", () => {
    expect(originMatchesSite("https://example.com.evil.test", "example.com")).toBe(false);
    expect(originMatchesSite("https://evil.test/example.com", "example.com")).toBe(false);
    expect(originMatchesSite("https://notexample.com", "example.com")).toBe(false);
    expect(originMatchesSite("https://blog.example.com", "example.com")).toBe(false); // subdomains are separate sites
  });

  it("rejects an unusable origin", () => {
    expect(originMatchesSite("null", "example.com")).toBe(false);
    expect(originMatchesSite("", "example.com")).toBe(false);
  });
});
