import { describe, expect, it } from "vitest";
import { autoTags, cleanTags, summarizeOutcome } from "../services/library.js";

describe("library helpers", () => {
  it("summarizeOutcome: lift in percent, P(best) and total sessions from the final stats", () => {
    const stats = { variants: [{ key: "a", pBest: 0.03, sessions: 400, lift: null }, { key: "b", pBest: 0.97, sessions: 410, lift: { estimate: 0.1234 } }] };
    expect(summarizeOutcome(stats, "b")).toEqual({ liftPct: 12.34, pBest: 0.97, sessions: 810 });
  });

  it("summarizeOutcome: copes with a decision made before any stats existed", () => {
    expect(summarizeOutcome(null, "b")).toEqual({ liftPct: null, pBest: null, sessions: 0 });
    expect(summarizeOutcome({ variants: [{ key: "b", lift: { estimate: null } }] }, "b").liftPct).toBeNull();
  });

  it("autoTags: type, post type and what kind of change it was", () => {
    const ops = [
      { op: "text", selector: "h1", value: "x" },
      { op: "style", selector: ".btn", styles: { color: "red" } },
      { op: "hide", selector: ".banner" },
      { op: "goal", selector: ".btn", name: "buy" },
    ] as any;
    expect(autoTags({ type: "element", wpPostType: "page" }, ops).sort()).toEqual(["copy", "element", "page", "removal", "style"]);
    expect(autoTags({ type: "page", wpPostType: "post" }, [])).toEqual(["page", "post"]);
  });

  it("cleanTags: lowercased, hyphenated, de-duplicated, bounded", () => {
    expect(cleanTags(["  Hero Copy ", "hero-copy", "", "CTA"])).toEqual(["hero-copy", "cta"]);
    expect(cleanTags(Array.from({ length: 40 }, (_, i) => "t" + i))).toHaveLength(20);
    expect(cleanTags(["x".repeat(100)])[0]).toHaveLength(32);
  });
});
