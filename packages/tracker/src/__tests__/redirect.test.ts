// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { redirectTarget } from "../runtime-inline.js";

describe("redirectTarget", () => {
  it("carries the ad click id, utm parameters and hash to the challenger", () => {
    expect(redirectTarget("https://x.test/page-b/", "?gclid=abc&utm_source=g", "#pricing")).toBe("https://x.test/page-b/?gclid=abc&utm_source=g#pricing");
  });

  it("joins with & when the challenger URL already has a query", () => {
    expect(redirectTarget("https://x.test/?p=77", "?gclid=abc", "")).toBe("https://x.test/?p=77&gclid=abc");
  });

  it("leaves the URL alone when the visitor has neither", () => {
    expect(redirectTarget("https://x.test/page-b/", "", "")).toBe("https://x.test/page-b/");
  });
});
