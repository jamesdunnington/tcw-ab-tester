// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyOps, runOps } from "../applier.js";
import type { ChangeOp } from "@tcw/shared";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = `<a id="cta" href="/old" style="color: blue">Buy</a><p class="lead">Hi</p><p class="lead">Yo</p>`;
});

describe("applyOps", () => {
  it("sets text on every match", () => {
    applyOps([{ op: "text", selector: ".lead", value: "X" }]);
    expect([...document.querySelectorAll(".lead")].map((e) => e.textContent)).toEqual(["X", "X"]);
  });

  it("sets html, attributes and hides", () => {
    applyOps([
      { op: "html", selector: "#cta", value: "<b>Go</b>" },
      { op: "attr", selector: "#cta", name: "href", value: "/new" },
      { op: "hide", selector: ".lead" },
    ]);
    const cta = document.getElementById("cta")!;
    expect(cta.innerHTML).toBe("<b>Go</b>");
    expect(cta.getAttribute("href")).toBe("/new");
    expect((document.querySelector(".lead") as HTMLElement).style.display).toBe("none");
  });

  it("applies styles with !important so theme CSS cannot win", () => {
    applyOps([{ op: "style", selector: "#cta", styles: { "background-color": "red" } }]);
    const el = document.getElementById("cta")!;
    expect(el.style.getPropertyValue("background-color")).toBe("red");
    expect(el.style.getPropertyPriority("background-color")).toBe("important");
  });

  it("skips invalid selectors and missing nodes without throwing", () => {
    const ops: ChangeOp[] = [
      { op: "text", selector: "###", value: "x" },
      { op: "text", selector: "#nope", value: "x" },
      { op: "text", selector: "#cta", value: "ok" },
    ];
    expect(() => applyOps(ops)).not.toThrow();
    expect(document.getElementById("cta")!.textContent).toBe("ok");
  });

  it("is idempotent: a second pass writes nothing", () => {
    const ops: ChangeOp[] = [{ op: "text", selector: "#cta", value: "Z" }];
    applyOps(ops);
    const mo = new MutationObserver(() => {});
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    applyOps(ops);
    expect(mo.takeRecords().length).toBe(0);
  });
});

describe("runOps anti-flicker", () => {
  it("hides only target elements, then reveals after applying", () => {
    runOps([{ op: "text", selector: "#cta", value: "New" }]);
    // jsdom's document is already parsed, so ops ran and the hide style is gone
    expect(document.getElementById("cta")!.textContent).toBe("New");
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("reveals on the safety timeout if the DOM never becomes ready", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    runOps([{ op: "hide", selector: "#cta" }], 400);
    expect(document.head.querySelector("style")?.textContent).toBe("#cta{visibility:hidden!important}");
    vi.advanceTimersByTime(400);
    expect(document.head.querySelector("style")).toBeNull();
    delete (document as unknown as Record<string, unknown>).readyState;
    vi.useRealTimers();
  });

  it("re-applies ops to late-inserted content", async () => {
    runOps([{ op: "text", selector: ".late", value: "patched" }]);
    document.body.insertAdjacentHTML("beforeend", `<span class="late">orig</span>`);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".late")!.textContent).toBe("patched");
  });
});
