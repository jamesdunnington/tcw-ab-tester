import type { ChangeOp } from "@tcw/shared";

/**
 * Selector generation for the visual editor (docs/PLAN.md section 7).
 * Strategy, most to least stable: id -> stable data attribute -> class +
 * nth-of-type path up to the nearest ancestor that makes it unique.
 * Output always satisfies changeOpSchema's selector rule (one selector, no
 * commas or braces), so it can be saved as-is.
 */

const STABLE_ATTRS = ["data-testid", "data-test", "data-id", "data-name", "data-section", "name", "aria-label"];
const STATE_CLASS = /^(is|has|js|active|open|show|hover|focus|selected|current|visible|hidden|loaded|tcwab)([-_]|$)/i;

/** CSS identifier escape (jsdom has no CSS.escape). */
export function esc(value: string): string {
  return value.replace(/^[0-9]|[^a-zA-Z0-9_\u00a0-\uffff-]/g, (ch, offset: number) =>
    offset === 0 && /[0-9]/.test(ch) ? String.raw`\3` + ch + " " : "\\" + ch,
  );
}

function attrSel(name: string, value: string): string {
  return `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
}

/** Classes worth keying on: not state toggles, not build hashes / generated numbers. */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => !STATE_CLASS.test(c) && !/\d{3,}/.test(c) && c.length <= 40);
}

function isUnique(doc: Document, sel: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(sel);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** Selector for one element relative to its parent, without ancestors. */
function step(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = stableClasses(el).slice(0, 2);
  let s = tag + classes.map((c) => `.${esc(c)}`).join("");
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return s;
}

export function buildSelector(el: Element, doc: Document = el.ownerDocument): string {
  if (el.id && !/\d{4,}/.test(el.id)) {
    const s = `#${esc(el.id)}`;
    if (isUnique(doc, s, el)) return s;
  }
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) {
      const s = `${el.tagName.toLowerCase()}${attrSel(attr, v)}`;
      if (isUnique(doc, s, el)) return s;
    }
  }
  // Walk up, prepending steps until the path is unique.
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement) {
    parts.unshift(step(cur));
    const sel = parts.join(" > ");
    if (isUnique(doc, sel, el)) return sel;
    if (cur.id && !/\d{4,}/.test(cur.id)) {
      const anchored = `#${esc(cur.id)} > ` + parts.slice(1).join(" > ");
      if (parts.length > 1 && isUnique(doc, anchored, el)) return anchored;
    }
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

export type Fingerprint = NonNullable<ChangeOp["fp"]>;

export function fingerprint(el: Element, doc: Document = el.ownerDocument): Fingerprint {
  const tag = el.tagName.toLowerCase();
  const index = Array.from(doc.querySelectorAll(tag)).indexOf(el);
  return { tag, text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120), index: Math.max(0, index) };
}

/**
 * Re-finds an element after a theme change broke its selector: same tag and
 * same text; if several match, the one closest to the recorded position.
 */
export function resolveByFingerprint(fp: Fingerprint, doc: Document = document): Element | null {
  const all = Array.from(doc.querySelectorAll(fp.tag));
  const same = all.filter((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120) === fp.text);
  if (same.length === 0) return null;
  return same.reduce((best, e) => (Math.abs(all.indexOf(e) - fp.index) < Math.abs(all.indexOf(best) - fp.index) ? e : best));
}
