import type { ChangeOp } from "@tcw/shared";
import { applyOps } from "../../tracker/src/applier.js";

/**
 * Live preview: renders the current ops onto the page using the SAME applier
 * the production runtime uses, so what the editor shows is what visitors get.
 * The applier only writes, so to show an undo we first put every touched
 * element back to how it was before we changed it.
 */
interface Snapshot {
  html: string;
  attrs: Array<[string, string]>;
}

export class PreviewRenderer {
  private snapshots = new Map<HTMLElement, Snapshot>();

  constructor(private doc: Document = document) {}

  render(ops: ChangeOp[]): void {
    this.restore();
    for (const o of ops) {
      let found: NodeListOf<HTMLElement>;
      try {
        found = this.doc.querySelectorAll<HTMLElement>(o.selector);
      } catch {
        continue;
      }
      found.forEach((el) => {
        if (this.snapshots.has(el)) return;
        this.snapshots.set(el, { html: el.innerHTML, attrs: Array.from(el.attributes, (a) => [a.name, a.value] as [string, string]) });
      });
    }
    applyOps(ops);
  }

  /** Puts every element the preview touched back to its original content and attributes. */
  restore(): void {
    this.snapshots.forEach((snap, el) => {
      if (el.innerHTML !== snap.html) el.innerHTML = snap.html;
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      for (const [name, value] of snap.attrs) el.setAttribute(name, value);
    });
    this.snapshots.clear();
  }
}
