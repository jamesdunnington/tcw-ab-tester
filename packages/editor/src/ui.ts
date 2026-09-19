import type { ChangeOp } from "@tcw/shared";
import { OpStore, readFields, setAttr, setGoal, setHidden, setStyle, setText } from "./ops.js";
import type { Fingerprint } from "./selector.js";

/**
 * The editor sidebar. Lives in the overlay's closed Shadow DOM, so the site's
 * CSS can't touch it. It only edits the OpStore; rendering the page and saving
 * are the caller's job (index.ts), driven by store changes.
 */
export interface SidebarHooks {
  variantKey: string;
  onSave: () => Promise<void>;
  onWidth: (px: number | null) => void;
}

export interface Selection {
  selector: string;
  fp: Fingerprint;
  tag: string;
  hasChildren: boolean;
  /** The element's current text and link, shown until an edit overrides them. */
  text: string;
  href: string;
}

type Target = { selector: string; fp: Fingerprint };

const STYLES = `
:host{all:initial}
.panel{position:fixed;top:0;right:0;bottom:0;width:300px;box-sizing:border-box;padding:14px;overflow:auto;pointer-events:auto;
  background:#0f172a;color:#e2e8f0;font:13px/1.45 system-ui,sans-serif;box-shadow:-4px 0 16px rgba(0,0,0,.35)}
h1{font-size:14px;margin:0 0 4px} .sub{color:#94a3b8;margin:0 0 12px;font-size:12px}
code{display:block;background:#1e293b;padding:6px 8px;border-radius:6px;word-break:break-all;font-size:11px;margin:4px 0 12px}
label{display:block;margin:10px 0 3px;color:#94a3b8;font-size:12px}
input[type=text],input[type=number],textarea,select{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #334155;
  background:#1e293b;color:#f8fafc;font:inherit} input.bad{border-color:#f87171}
textarea{min-height:56px;resize:vertical} .row{display:flex;gap:6px;margin-top:12px}
button{flex:1;padding:7px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#f8fafc;font:inherit;cursor:pointer}
button.primary{background:#2563eb;border-color:#2563eb} button:disabled{opacity:.4;cursor:default}
.check{display:flex;align-items:center;gap:8px;margin-top:10px;color:#e2e8f0}.check input{margin:0}
.actions{position:sticky;top:-14px;margin:0 -14px 8px;padding:8px 14px;background:#0f172a;z-index:1;border-bottom:1px solid #1e293b}.actions .row{margin-top:0}
.hint{color:#94a3b8;font-size:11px;margin-top:3px} #status{margin-top:6px;min-height:16px;font-size:12px}
`;

const BODY = (variantKey: string) => `
  <h1>Editing variant ${variantKey.toUpperCase()}</h1>
  <p class="sub">Click an element on the page to edit it.</p>
  <div class="actions">
    <div class="row"><button id="undo">Undo</button><button id="redo">Redo</button><button id="save" class="primary">Save</button></div>
    <div id="status"></div>
  </div>
  <div id="fields" hidden>
    <code id="selector"></code>
    <label>Text</label><textarea id="text"></textarea><div class="hint" id="texthint"></div>
    <div id="linkrow"><label>Link URL</label><input type="text" id="href" placeholder="/pricing"></div>
    <label>Text color</label><input type="text" id="color" placeholder="#ffffff">
    <label>Background color</label><input type="text" id="bg" placeholder="#2563eb">
    <label>Font size (px)</label><input type="number" id="size" min="8" max="200">
    <label>Corner radius (px)</label><input type="number" id="radius" min="0" max="200">
    <div class="check"><input type="checkbox" id="hide"><span>Hide this element</span></div>
    <label>Goal name (clicks on this element count as conversions)</label>
    <input type="text" id="goal" placeholder="signup">
  </div>
  <label>Width preview</label>
  <select id="device"><option value="">Full width</option><option value="768">Tablet (768)</option><option value="375">Phone (375)</option></select>
  <div class="hint">Approximate: the page's responsive breakpoints still follow your real window.</div>
`;

export class Sidebar {
  private sel: Selection | null = null;
  private els: Record<string, HTMLElement> = {};

  constructor(
    private root: ShadowRoot,
    private store: OpStore,
    private hooks: SidebarHooks,
  ) {
    const style = document.createElement("style");
    style.textContent = STYLES;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = BODY(hooks.variantKey);
    this.root.append(style, panel);
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>("[id]"))) this.els[el.id] = el;

    this.bind("text", (v) => this.edit((o, t) => setText(o, t, v)));
    this.bind("href", (v) => this.edit((o, t) => setAttr(o, t, "href", v.trim() || null)));
    this.bindColor("color", "color");
    this.bindColor("bg", "background-color");
    this.bindPx("size", "font-size");
    this.bindPx("radius", "border-radius");
    this.els.hide.addEventListener("change", () => this.edit((o, t) => setHidden(o, t, (this.els.hide as HTMLInputElement).checked)));
    this.bind("goal", (v) => this.edit((o, t) => setGoal(o, t, v.trim() || null)));
    this.els.device.addEventListener("change", () => hooks.onWidth(Number((this.els.device as HTMLSelectElement).value) || null));
    this.els.undo.addEventListener("click", () => store.undo());
    this.els.redo.addEventListener("click", () => store.redo());
    this.els.save.addEventListener("click", () => void this.save());
    store.subscribe(() => this.refresh());
    this.refresh();
  }

  select(s: Selection): void {
    this.sel = s;
    this.els.fields.hidden = false;
    this.els.selector.textContent = s.selector;
    this.els.linkrow.hidden = s.tag !== "a";
    (this.els.text as HTMLTextAreaElement).disabled = s.hasChildren;
    this.els.texthint.textContent = s.hasChildren ? "This element contains other elements, so its text can't be replaced safely." : "";
    this.refresh();
  }

  setStatus(msg: string, error = false): void {
    this.els.status.textContent = msg;
    this.els.status.style.color = error ? "#f87171" : "#86efac";
  }

  async save(): Promise<void> {
    this.setStatus("Saving...");
    try {
      await this.hooks.onSave();
      this.store.markSaved();
      this.setStatus("Saved");
    } catch (e) {
      this.setStatus(`Not saved: ${(e as Error).message}`, true);
    }
  }

  private edit(fn: (ops: ChangeOp[], t: Target) => ChangeOp[]): void {
    if (!this.sel) return;
    this.store.commit(fn(this.store.ops, { selector: this.sel.selector, fp: this.sel.fp }));
  }

  private bind(id: string, on: (v: string) => void): void {
    this.els[id].addEventListener("change", () => on((this.els[id] as HTMLInputElement).value));
  }

  private bindColor(id: string, prop: string): void {
    this.els[id].addEventListener("change", () => {
      const input = this.els[id] as HTMLInputElement;
      const v = input.value.trim();
      const valid = v === "" || (typeof CSS !== "undefined" && CSS.supports ? CSS.supports("color", v) : /^#[0-9a-f]{3,8}$/i.test(v));
      input.classList.toggle("bad", !valid);
      if (valid) this.edit((o, t) => setStyle(o, t, prop, v || null));
    });
  }

  private bindPx(id: string, prop: string): void {
    this.els[id].addEventListener("change", () => {
      const v = (this.els[id] as HTMLInputElement).value;
      this.edit((o, t) => setStyle(o, t, prop, v === "" ? null : `${Number(v)}px`));
    });
  }

  private refresh(): void {
    (this.els.undo as HTMLButtonElement).disabled = !this.store.canUndo;
    (this.els.redo as HTMLButtonElement).disabled = !this.store.canRedo;
    (this.els.save as HTMLButtonElement).disabled = !this.store.dirty;
    if (!this.sel) return;
    const f = readFields(this.store.ops, this.sel.selector);
    const px = (p: string) => (f.styles[p] ? String(parseFloat(f.styles[p])) : "");
    const set = (id: string, v: string) => ((this.els[id] as HTMLInputElement).value = v);
    set("text", f.text ?? this.sel.text);
    set("href", f.href ?? this.sel.href);
    set("color", f.styles.color ?? "");
    set("bg", f.styles["background-color"] ?? "");
    set("size", px("font-size"));
    set("radius", px("border-radius"));
    set("goal", f.goal ?? "");
    (this.els.hide as HTMLInputElement).checked = f.hidden;
  }
}
