// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { changeOpsSchema } from "@tcw/shared";
import { OpStore, setStyle, setText, setAttr, setHidden, setGoal, readFields } from "../ops.js";
import { PreviewRenderer } from "../preview.js";
import { EditorApi, type EditorBoot } from "../api.js";

const t = { selector: "#cta" };

describe("op helpers", () => {
  it("merges style edits into one op and clears properties", () => {
    let ops = setStyle([], t, "color", "red");
    ops = setStyle(ops, t, "background-color", "blue");
    expect(ops).toHaveLength(1);
    expect(readFields(ops, "#cta").styles).toEqual({ color: "red", "background-color": "blue" });
    ops = setStyle(ops, t, "color", null);
    expect(readFields(ops, "#cta").styles).toEqual({ "background-color": "blue" });
    ops = setStyle(ops, t, "background-color", "");
    expect(ops).toEqual([]);
  });

  it("replaces, not stacks, repeated edits of the same field", () => {
    let ops = setText([], t, "One");
    ops = setText(ops, t, "Two");
    ops = setAttr(ops, t, "href", "/a");
    ops = setAttr(ops, t, "href", "/b");
    expect(ops).toHaveLength(2);
    expect(readFields(ops, "#cta")).toMatchObject({ text: "Two", href: "/b" });
  });

  it("toggles hide and goal", () => {
    let ops = setHidden([], t, true);
    ops = setGoal(ops, t, "signup");
    expect(readFields(ops, "#cta")).toMatchObject({ hidden: true, goal: "signup" });
    ops = setHidden(ops, t, false);
    ops = setGoal(ops, t, null);
    expect(ops).toEqual([]);
  });

  it("only ever produces ops the hub will accept", () => {
    let ops = setStyle([], t, "color", "#fff");
    ops = setText(ops, t, "Buy now");
    ops = setAttr(ops, t, "href", "/pricing");
    ops = setHidden(ops, { selector: ".banner" }, true);
    ops = setGoal(ops, t, "signup");
    expect(changeOpsSchema.safeParse(ops).success).toBe(true);
  });
});

describe("OpStore undo/redo", () => {
  it("undoes and redoes, and clears redo on a new edit", () => {
    const s = new OpStore();
    s.commit(setText(s.ops, t, "A"));
    s.commit(setText(s.ops, t, "B"));
    expect(readFields(s.ops, "#cta").text).toBe("B");
    s.undo();
    expect(readFields(s.ops, "#cta").text).toBe("A");
    expect(s.canRedo).toBe(true);
    s.redo();
    expect(readFields(s.ops, "#cta").text).toBe("B");
    s.undo();
    s.commit(setText(s.ops, t, "C"));
    expect(s.canRedo).toBe(false);
  });

  it("tracks unsaved changes and notifies subscribers", () => {
    const s = new OpStore();
    const seen = vi.fn();
    s.subscribe(seen);
    expect(s.dirty).toBe(false);
    s.commit(setHidden(s.ops, t, true));
    expect(s.dirty).toBe(true);
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.undo();
    expect(s.dirty).toBe(true);
    expect(seen).toHaveBeenCalledTimes(3); // commit, markSaved, undo
  });

  it("ignores a commit that changes nothing", () => {
    const s = new OpStore();
    s.commit([]);
    expect(s.canUndo).toBe(false);
  });
});

describe("PreviewRenderer", () => {
  beforeEach(() => {
    document.body.innerHTML = `<a id="cta" href="/old" class="btn">Buy</a><p id="p">Hello</p>`;
  });

  it("shows edits and fully reverts them when the ops go away (undo)", () => {
    const r = new PreviewRenderer();
    r.render([
      { op: "text", selector: "#cta", value: "Go" },
      { op: "attr", selector: "#cta", name: "href", value: "/new" },
      { op: "style", selector: "#cta", styles: { color: "red" } },
      { op: "hide", selector: "#p" },
    ]);
    const cta = document.getElementById("cta")!;
    expect(cta.textContent).toBe("Go");
    expect(cta.getAttribute("href")).toBe("/new");
    expect((document.getElementById("p") as HTMLElement).style.display).toBe("none");

    r.render([]);
    expect(cta.textContent).toBe("Buy");
    expect(cta.getAttribute("href")).toBe("/old");
    expect(cta.getAttribute("style")).toBeNull();
    expect(document.getElementById("p")!.getAttribute("style")).toBeNull();
    expect(cta.className).toBe("btn");
  });

  it("re-rendering with changed ops starts from the original, not the previous edit", () => {
    const r = new PreviewRenderer();
    r.render([{ op: "text", selector: "#p", value: "One" }]);
    r.render([{ op: "text", selector: "#p", value: "Two" }]);
    r.render([]);
    expect(document.getElementById("p")!.textContent).toBe("Hello");
  });
});

describe("EditorApi", () => {
  const boot = (): EditorBoot => ({ hubUrl: "https://hub.test", siteKey: "k", testId: "t", variantKey: "b", token: "tok1", expiresAt: 1000 });
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

  afterEach(() => vi.useRealTimers());

  it("sends the bearer token and returns loaded ops", async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { ops: [{ op: "hide", selector: "#a" }] }));
    const api = new EditorApi(boot(), f as unknown as typeof fetch);
    expect(await api.loadOps()).toEqual([{ op: "hide", selector: "#a" }]);
    expect(f).toHaveBeenCalledWith("https://hub.test/editor/ops", expect.objectContaining({ method: "GET", headers: expect.objectContaining({ authorization: "Bearer tok1" }) }));
  });

  it("surfaces the hub's error code on failure", async () => {
    const f = vi.fn().mockResolvedValue(reply(401, { error: "token_expired" }));
    await expect(new EditorApi(boot(), f as unknown as typeof fetch).saveOps([])).rejects.toThrow("token_expired");
  });

  it("renews before expiry and uses the new token afterwards", async () => {
    vi.useFakeTimers();
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { token: "tok2", expiresAt: 1300 }))
      .mockResolvedValue(reply(200, { ok: true }));
    const api = new EditorApi(boot(), f as unknown as typeof fetch);
    api.startRenewing(() => 900); // expires in 100s, margin 90s -> renew in 10s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.mock.calls[0][0]).toBe("https://hub.test/editor/renew");
    await api.saveOps([]);
    expect(f.mock.calls[1][1].headers.authorization).toBe("Bearer tok2");
    api.stop();
  });

  it("reports when renewal is refused", async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValue(reply(401, { error: "session_too_long" }));
    const api = new EditorApi(boot(), f as unknown as typeof fetch);
    const lost = vi.fn();
    api.onAuthLost = lost;
    api.startRenewing(() => 900);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lost).toHaveBeenCalledWith("session_too_long");
  });
});
