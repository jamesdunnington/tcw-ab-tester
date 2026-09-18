import { describe, expect, it } from "vitest";
import { deriveIncrements } from "../increments.js";
import type { QueuedTrackerEventInput } from "@tcw/shared";

function baseEvent(overrides: Partial<QueuedTrackerEventInput>): QueuedTrackerEventInput {
  return {
    siteId: "11111111-1111-4111-8111-111111111111",
    testId: "22222222-2222-4222-8222-222222222222",
    variantKey: "a",
    visitorId: "33333333-3333-4333-8333-333333333333",
    sessionId: "44444444-4444-4444-8444-444444444444",
    device: "desktop",
    type: "pageview",
    ts: Date.now(),
    url: "https://example.com/",
    ...overrides,
  };
}

describe("deriveIncrements", () => {
  it("heartbeat: passes through a normal deltaMs", () => {
    const result = deriveIncrements(baseEvent({ type: "heartbeat", data: { deltaMs: 4200 } }));
    expect(result).toEqual({ activeMs: 4200, maxScrollPct: 0, clicked: false, rageClicks: 0 });
  });

  it("heartbeat: clamps an implausibly large deltaMs (defends against a hung tab or clock skew)", () => {
    const result = deriveIncrements(baseEvent({ type: "heartbeat", data: { deltaMs: 999_999 } }));
    expect(result.activeMs).toBe(10_000);
  });

  it("heartbeat: defaults to 5000ms when deltaMs is missing", () => {
    const result = deriveIncrements(baseEvent({ type: "heartbeat", data: {} }));
    expect(result.activeMs).toBe(5000);
  });

  it("scroll_depth: clamps pct to [0, 100]", () => {
    expect(deriveIncrements(baseEvent({ type: "scroll_depth", data: { pct: 150 } })).maxScrollPct).toBe(100);
    expect(deriveIncrements(baseEvent({ type: "scroll_depth", data: { pct: -20 } })).maxScrollPct).toBe(0);
    expect(deriveIncrements(baseEvent({ type: "scroll_depth", data: { pct: 47 } })).maxScrollPct).toBe(47);
  });

  it("click: sets clicked true, does not touch rageClicks", () => {
    const result = deriveIncrements(baseEvent({ type: "click" }));
    expect(result.clicked).toBe(true);
    expect(result.rageClicks).toBe(0);
  });

  it("rage_click: increments rageClicks by 1, does not set clicked", () => {
    const result = deriveIncrements(baseEvent({ type: "rage_click", data: { count: 5 } }));
    expect(result.rageClicks).toBe(1);
    expect(result.clicked).toBe(false);
  });

  it("pageview/scroll_stop/hover/visibility_end: zero increments (rollup row still gets created by the upsert)", () => {
    for (const type of ["pageview", "scroll_stop", "hover", "visibility_end"] as const) {
      expect(deriveIncrements(baseEvent({ type }))).toEqual({
        activeMs: 0,
        maxScrollPct: 0,
        clicked: false,
        rageClicks: 0,
      });
    }
  });
});
