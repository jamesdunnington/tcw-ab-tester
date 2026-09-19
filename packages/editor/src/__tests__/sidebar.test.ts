// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpStore } from "../ops.js";
import { PreviewRenderer } from "../preview.js";
import { Sidebar, type Selection } from "../ui.js";
import { fingerprint } from "../selector.js";

const q = <T extends HTMLElement>(root: ShadowRoot, id: string) => root.getElementById(id) as unknown as T;
const change = (el: HTMLElement) => el.dispatchEvent(new Event("change", { bubbles: true }));

let root: ShadowRoot;
let store: OpStore;
let onSave: ReturnType<typeof vi.fn>;
let onWidth: ReturnType<typeof vi.fn>;
let sidebar: Sidebar;

function pick(id: string): Selection {
  const el = document.getElementById(id)!;
  return {
    selector: `#${id}`,
    fp: fingerprint(el),
    tag: el.tagName.toLowerCase(),
    hasChildren: el.children.length > 0,
    text: (el.textContent ?? "").trim(),
    href: el.getAttribute("href") ?? "",
  };
}

beforeEach(() => {
  document.body.innerHTML = `<a id="cta" href="/old">Buy now</a><div id="box"><b>x</b></div>`;
  const host = document.createElement("div");
  root = host.attachShadow({ mode: "open" });
  store = new OpStore();
  onSave = vi.fn().mockResolvedValue(undefined);
  onWidth = vi.fn();
  sidebar = new Sidebar(root, store, { variantKey: "b", onSave: onSave as never, onWidth: onWidth as never });
  const preview = new PreviewRenderer();
  store.subscribe(() => preview.render(store.ops));
});

describe("Sidebar", () => {
  it("shows the element's current text and link until edited", () => {
    sidebar.select(pick("cta"));
    expect(q<HTMLTextAreaElement>(root, "text").value).toBe("Buy now");
    expect(q<HTMLInputElement>(root, "href").value).toBe("/old");
  });

  it("edits text, link, colours and size and updates the live page", () => {
    sidebar.select(pick("cta"));
    const set = (id: string, v: string) => {
      q<HTMLInputElement>(root, id).value = v;
      change(q(root, id));
    };
    set("text", "Start free trial");
    set("href", "/signup");
    set("bg", "#2563eb");
    set("size", "20");

    const cta = document.getElementById("cta")!;
    expect(cta.textContent).toBe("Start free trial");
    expect(cta.getAttribute("href")).toBe("/signup");
    expect(cta.style.getPropertyValue("background-color")).toBe("rgb(37, 99, 235)"); // browsers normalise hex on read-back
    expect(cta.style.getPropertyValue("font-size")).toBe("20px");
    expect(store.ops.map((o) => o.op).sort()).toEqual(["attr", "style", "text"]);
  });

  it("undo reverts the page and the fields; redo brings it back", () => {
    sidebar.select(pick("cta"));
    q<HTMLTextAreaElement>(root, "text").value = "Hi";
    change(q(root, "text"));
    expect(document.getElementById("cta")!.textContent).toBe("Hi");

    q<HTMLButtonElement>(root, "undo").click();
    expect(document.getElementById("cta")!.textContent).toBe("Buy now");
    expect(q<HTMLTextAreaElement>(root, "text").value).toBe("Buy now");

    q<HTMLButtonElement>(root, "redo").click();
    expect(document.getElementById("cta")!.textContent).toBe("Hi");
  });

  it("flags a goal and hides an element", () => {
    sidebar.select(pick("cta"));
    q<HTMLInputElement>(root, "goal").value = "signup";
    change(q(root, "goal"));
    expect(document.getElementById("cta")!.getAttribute("data-tcwab-goal")).toBe("signup");

    const hide = q<HTMLInputElement>(root, "hide");
    hide.checked = true;
    change(hide);
    expect(document.getElementById("cta")!.style.display).toBe("none");
  });

  it("rejects an invalid colour instead of saving it", () => {
    sidebar.select(pick("cta"));
    const bg = q<HTMLInputElement>(root, "bg");
    bg.value = "not a colour!!";
    change(bg);
    expect(store.ops).toEqual([]);
    expect(bg.classList.contains("bad")).toBe(true);
  });

  it("won't replace the text of an element that contains other elements", () => {
    sidebar.select(pick("box"));
    expect(q<HTMLTextAreaElement>(root, "text").disabled).toBe(true);
  });

  it("only shows the link field for anchors", () => {
    sidebar.select(pick("cta"));
    expect(q(root, "linkrow").hidden).toBe(false);
    sidebar.select(pick("box"));
    expect(q(root, "linkrow").hidden).toBe(true);
  });

  it("saves, then marks clean; reports failures without losing edits", async () => {
    sidebar.select(pick("cta"));
    q<HTMLTextAreaElement>(root, "text").value = "Hi";
    change(q(root, "text"));
    expect(q<HTMLButtonElement>(root, "save").disabled).toBe(false);

    await sidebar.save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(store.dirty).toBe(false);
    expect(q(root, "status").textContent).toBe("Saved");

    onSave.mockRejectedValueOnce(new Error("token_expired"));
    q<HTMLTextAreaElement>(root, "text").value = "Again";
    change(q(root, "text"));
    await sidebar.save();
    expect(store.dirty).toBe(true);
    expect(q(root, "status").textContent).toContain("token_expired");
  });

  it("reports the chosen preview width", () => {
    const sel = q<HTMLSelectElement>(root, "device");
    sel.value = "375";
    change(sel);
    expect(onWidth).toHaveBeenCalledWith(375);
    sel.value = "";
    change(sel);
    expect(onWidth).toHaveBeenLastCalledWith(null);
  });
});
