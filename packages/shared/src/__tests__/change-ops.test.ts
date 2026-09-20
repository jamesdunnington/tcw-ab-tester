import { describe, it, expect } from "vitest";
import { changeOpSchema, changeOpsSchema, mergeGoalOps } from "../change-ops.js";

const ok = (v: unknown) => changeOpSchema.safeParse(v).success;

describe("changeOpSchema", () => {
  it("accepts each op type", () => {
    expect(ok({ op: "text", selector: "#a", value: "hi" })).toBe(true);
    expect(ok({ op: "html", selector: ".b > i", value: "<b>x</b>" })).toBe(true);
    expect(ok({ op: "style", selector: "#a", styles: { "background-color": "#f00" } })).toBe(true);
    expect(ok({ op: "attr", selector: "#a", name: "href", value: "/pricing" })).toBe(true);
    expect(ok({ op: "hide", selector: "#a", fp: { tag: "a", text: "Buy", index: 0 } })).toBe(true);
  });

  it("refuses selectors that target AdSense or Mediavine containers", () => {
    expect(ok({ op: "hide", selector: "ins.adsbygoogle" })).toBe(false);
    expect(ok({ op: "text", selector: "#google_ads_iframe_/123/x_0" })).toBe(false);
    expect(ok({ op: "hide", selector: "div.mv-ads > div" })).toBe(false);
    expect(ok({ op: "style", selector: "#mediavine-slot-1", styles: { color: "red" } })).toBe(false);
    expect(ok({ op: "text", selector: "h1.wp-block-post-title", value: "Fine" })).toBe(true);
  });

  it("rejects selector lists and rule-breaking characters", () => {
    expect(ok({ op: "hide", selector: "#a, #b" })).toBe(false);
    expect(ok({ op: "hide", selector: "#a{color:red}" })).toBe(false);
    expect(ok({ op: "hide", selector: "" })).toBe(false);
  });

  it("rejects unsafe css values and empty style maps", () => {
    expect(ok({ op: "style", selector: "#a", styles: { background: "url(http://x/y.png)" } })).toBe(false);
    expect(ok({ op: "style", selector: "#a", styles: { color: "red; display:none" } })).toBe(false);
    expect(ok({ op: "style", selector: "#a", styles: {} })).toBe(false);
  });

  it("rejects event-handler attributes, inline style and script URLs", () => {
    expect(ok({ op: "attr", selector: "#a", name: "onclick", value: "x()" })).toBe(false);
    expect(ok({ op: "attr", selector: "#a", name: "style", value: "color:red" })).toBe(false);
    expect(ok({ op: "attr", selector: "#a", name: "href", value: "javascript:alert(1)" })).toBe(false);
  });

  it("rejects unknown op types and caps the array", () => {
    expect(ok({ op: "js", selector: "#a", value: "x" })).toBe(false);
    const many = Array.from({ length: 201 }, () => ({ op: "hide", selector: "#a" }));
    expect(changeOpsSchema.safeParse(many).success).toBe(false);
  });
});

describe("mergeGoalOps", () => {
  const goal = { op: "goal", selector: "#cta", name: "signup" } as const;
  const hide = { op: "hide", selector: ".banner" } as const;

  it("gives the control variant the goals declared on a challenger", () => {
    const [control, b] = mergeGoalOps([[], [hide, goal]]);
    expect(control).toEqual([goal]);
    expect(b).toEqual([hide, goal]);
  });

  it("de-duplicates identical goals declared on several variants", () => {
    const out = mergeGoalOps([[goal], [goal, hide]]);
    expect(out[0]).toEqual([goal]);
    expect(out[1]).toEqual([hide, goal]);
  });

  it("rejects malformed goal names", () => {
    expect(ok({ op: "goal", selector: "#a", name: "has space" })).toBe(false);
    expect(ok({ op: "goal", selector: "#a", name: "signup" })).toBe(true);
  });
});
