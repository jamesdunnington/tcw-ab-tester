import type { ChangeOp } from "@tcw/shared";

/**
 * DOM change-op applier for element tests. Bundled into runtime-inline.ts, so
 * keep it tiny (inline budget is 2KB gzipped). Validation lives on the hub
 * (changeOpSchema); here we only guard against bad selectors and missing nodes.
 *
 * Idempotent: every write is skipped when the DOM already matches, so the
 * MutationObserver that re-applies ops to late content can't feed itself.
 */

function each(sel: string, fn: (el: HTMLElement) => void): void {
  try {
    document.querySelectorAll<HTMLElement>(sel).forEach(fn);
  } catch {
    /* invalid selector: skip this op, never break the page */
  }
}

export function applyOps(ops: ChangeOp[]): void {
  for (const o of ops) {
    each(o.selector, (el) => {
      if (o.op === "text") {
        if (el.textContent !== o.value) el.textContent = o.value;
      } else if (o.op === "html") {
        if (el.innerHTML !== o.value) el.innerHTML = o.value;
      } else if (o.op === "style") {
        for (const k in o.styles) {
          if (el.style.getPropertyValue(k) !== o.styles[k]) el.style.setProperty(k, o.styles[k], "important");
        }
      } else if (o.op === "attr") {
        if (el.getAttribute(o.name) !== o.value) el.setAttribute(o.name, o.value);
      } else if (el.style.display !== "none") {
        el.style.setProperty("display", "none", "important");
      }
    });
  }
}

/**
 * Hide only the target elements until their ops are applied (never the whole
 * page), then reveal. Reveal happens once the DOM is parsed and ops are
 * applied, or after `timeout` ms, whichever comes first.
 */
export function runOps(ops: ChangeOp[], timeout = 400): void {
  const style = document.createElement("style");
  // One rule per selector so a single invalid selector drops only its own rule.
  style.textContent = ops.map((o) => `${o.selector}{visibility:hidden!important}`).join("");
  (document.head || document.documentElement).appendChild(style);

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    style.remove();
  };

  const run = () => {
    applyOps(ops);
    reveal();
  };
  setTimeout(reveal, timeout);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();

  // Late content (lazy widgets, page builders): re-apply as the DOM changes.
  if (typeof MutationObserver === "function") {
    new MutationObserver(() => applyOps(ops)).observe(document.documentElement, { childList: true, subtree: true });
  }
}
