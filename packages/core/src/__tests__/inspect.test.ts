import { describe, expect, it } from "vitest";
import { assertSafeFetchUrl, buildOutline, checkSelectors, isPrivateAddress } from "../services/inspect.js";

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local (cloud metadata) and CGNAT ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertSafeFetchUrl", () => {
  it("only accepts the registered site's own host", async () => {
    await expect(assertSafeFetchUrl("https://evil.example/x", "https://shop.example", true)).rejects.toThrow("host_not_the_registered_site");
    await expect(assertSafeFetchUrl("https://shop.example.evil.example/x", "shop.example", true)).rejects.toThrow("host_not_the_registered_site");
    await expect(assertSafeFetchUrl("https://SHOP.example/page", "shop.example", true)).resolves.toBeInstanceOf(URL);
  });

  it("rejects non-http schemes, embedded credentials and junk", async () => {
    await expect(assertSafeFetchUrl("file:///etc/passwd", "shop.example", true)).rejects.toThrow("unsupported_scheme");
    await expect(assertSafeFetchUrl("https://user:pw@shop.example/", "shop.example", true)).rejects.toThrow("credentials_in_url");
    await expect(assertSafeFetchUrl("not a url", "shop.example", true)).rejects.toThrow("invalid_url");
  });

  it("blocks a registered host that is a private IP unless private fetches are allowed", async () => {
    await expect(assertSafeFetchUrl("http://169.254.169.254/latest/meta-data", "http://169.254.169.254", false)).rejects.toThrow("private_address_blocked");
    await expect(assertSafeFetchUrl("http://127.0.0.1:8080/", "http://127.0.0.1:8080", false)).rejects.toThrow("private_address_blocked");
    await expect(assertSafeFetchUrl("http://127.0.0.1:8080/", "http://127.0.0.1:8080", true)).resolves.toBeInstanceOf(URL);
  });
});

const HTML = `<html><head><title>Pricing</title><style>.x{}</style></head><body>
<header><nav id="top-nav"><a href="/">Home</a></nav></header>
<main id="main">
  <h1 id="hero">Simple pricing</h1>
  <section><p>First</p><p>Second</p></section>
  <a class="button primary" href="/signup">Start free trial</a>
  <img src="/logo.png" alt="">
</main>
<script>document.write("secret")</script><noscript>nojs</noscript>
</body></html>`;

describe("buildOutline", () => {
  const outline = buildOutline(HTML);

  it("reads the title and skips scripts and styles", () => {
    expect(outline.title).toBe("Pricing");
    expect(JSON.stringify(outline)).not.toContain("secret");
    expect(JSON.stringify(outline)).not.toContain("nojs");
  });

  it("prefers id selectors and gives every node a selector that matches exactly one element", () => {
    expect(outline.nodes.find((n) => n.text === "Simple pricing")?.selector).toBe("#hero");
    const checks = checkSelectors(HTML, outline.nodes.map((n) => n.selector));
    for (const c of checks) expect(c.matches, c.selector).toBe(1);
  });

  it("builds a stable path for elements without an id, and disambiguates siblings", () => {
    const first = outline.nodes.find((n) => n.text === "First");
    const second = outline.nodes.find((n) => n.text === "Second");
    expect(first?.selector).not.toBe(second?.selector);
    expect(first?.selector).toContain("#main");
    expect(outline.nodes.find((n) => n.text === "Start free trial")).toMatchObject({ tag: "a", href: "/signup", classes: ["button", "primary"] });
  });

  it("caps the outline size", () => {
    const big = `<body>${Array.from({ length: 400 }, (_, i) => `<p>row ${i}</p>`).join("")}</body>`;
    const result = buildOutline(big);
    expect(result.nodes.length).toBeLessThanOrEqual(160);
    expect(result.truncated).toBe(true);
  });
});

describe("checkSelectors", () => {
  it("reports match counts and survives invalid selectors", () => {
    const [ok, none, bad] = checkSelectors(HTML, ["#hero", ".missing", "###"]);
    expect(ok).toMatchObject({ matches: 1, sampleText: "Simple pricing" });
    expect(none.matches).toBe(0);
    expect(bad.matches).toBe(0);
  });
});
