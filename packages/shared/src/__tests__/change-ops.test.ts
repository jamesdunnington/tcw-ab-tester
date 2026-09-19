import { describe, it, expect } from "vitest";
import { changeOpSchema, changeOpsSchema } from "../change-ops.js";

const ok = (v: unknown) => changeOpSchema.safeParse(v).success;

describe("changeOpSchema", () => {
  it("accepts each op type", () => {
    expect(ok({ op: "text", selector: "#a", value: "hi" })).toBe(true);
    expect(ok({ op: "html", selector: ".b > i", value: "<b>x</b>" })).toBe(true);
    expect(ok({ op: "style", selector: "#a", styles: { "background-color": "#f00" } })).toBe(true);
    expect(ok({ op: "attr", selector: "#a", name: "href", value: "/pricing" })).toBe(true);
    expect(ok({ op: "hide", selector: "#a", fp: { tag: "a", text: "Buy", index: 0 } })).toBe(true);
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
