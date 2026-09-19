// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildSelector, fingerprint, resolveByFingerprint, esc } from "../selector.js";
import { changeOpSchema } from "@tcw/shared";

const q = (s: string) => document.querySelector(s)!;

beforeEach(() => {
  document.body.innerHTML = `
    <header id="top"><a class="btn primary is-active" href="/a">Buy</a></header>
    <main>
      <section class="hero"><p>One</p><p>Two</p><button data-testid="cta" class="btn">Go</button></section>
      <section class="hero"><p>Three</p><button class="btn">Go</button></section>
      <div id="x12345"><span class="w-9999">deep</span></div>
    </main>`;
});

describe("buildSelector", () => {
  it("prefers a unique id", () => {
    expect(buildSelector(q("#top"))).toBe("#top");
  });

  it("uses a stable data attribute when there is no id", () => {
    expect(buildSelector(q("button[data-testid]"))).toBe('button[data-testid="cta"]');
  });

  it("falls back to a class + nth-of-type path that is unique", () => {
    const el = document.querySelectorAll("section.hero p")[1];
    const sel = buildSelector(el);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
    expect(sel).toContain(":nth-of-type(2)");
  });

  it("ignores state classes and generated ids/classes", () => {
    const a = q("header a");
    expect(buildSelector(a)).not.toContain("is-active");
    const deep = q("span");
    const sel = buildSelector(deep);
    expect(sel).not.toContain("w-9999");
    expect(sel).not.toContain("x12345");
    expect(document.querySelector(sel)).toBe(deep);
  });

  it("disambiguates identical siblings across sections", () => {
    const second = document.querySelectorAll("section.hero button")[1];
    expect(document.querySelector(buildSelector(second))).toBe(second);
  });

  it("always produces a selector changeOpSchema accepts", () => {
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const selector = buildSelector(el);
      expect(changeOpSchema.safeParse({ op: "hide", selector }).success, selector).toBe(true);
    }
  });

  it("escapes awkward identifiers", () => {
    expect(esc("1abc")).toBe(String.raw`\31 abc`);
    expect(esc("a:b")).toBe(String.raw`a\:b`);
  });
});

describe("fingerprint", () => {
  it("records tag, normalised text and position", () => {
    const fp = fingerprint(document.querySelectorAll("p")[2]);
    expect(fp).toEqual({ tag: "p", text: "Three", index: 2 });
  });

  it("re-finds an element whose selector no longer matches", () => {
    const fp = fingerprint(q("button[data-testid]"));
    document.querySelector("button[data-testid]")!.removeAttribute("data-testid");
    expect(resolveByFingerprint(fp)).toBe(document.querySelectorAll("button")[0]);
  });

  it("picks the nearest match when text repeats, and null when gone", () => {
    const fp = fingerprint(document.querySelectorAll("button")[1]);
    expect(resolveByFingerprint(fp)).toBe(document.querySelectorAll("button")[1]);
    expect(resolveByFingerprint({ tag: "button", text: "Nope", index: 0 })).toBeNull();
  });
});
