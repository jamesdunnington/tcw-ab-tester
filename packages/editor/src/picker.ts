/**
 * Element picker. Hover outlines the element under the cursor; a click selects
 * it instead of following links or firing the page's own handlers. All editor
 * UI lives in a closed Shadow DOM so the site's CSS can't restyle it.
 */

export const HOST_ATTR = "data-tcwab-editor-host";

export interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  destroy(): void;
}

/** Creates the editor's shadow-DOM host, attached last in <body>. */
export function mountOverlay(doc: Document = document): Overlay {
  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  doc.body.appendChild(host);
  return { host, root, destroy: () => host.remove() };
}

export interface Picker {
  start(): void;
  stop(): void;
}

export function createPicker(
  overlay: Overlay,
  onPick: (el: Element) => void,
  doc: Document = document,
): Picker {
  const box = doc.createElement("div");
  box.style.cssText =
    "position:fixed;display:none;box-sizing:border-box;border:2px solid #2563eb;background:rgba(37,99,235,.12);pointer-events:none;";
  overlay.root.appendChild(box);

  const isEditorUi = (t: EventTarget | null) => t instanceof Node && overlay.host.contains(t);

  function onMove(e: MouseEvent): void {
    const t = e.target;
    if (!(t instanceof Element) || isEditorUi(t) || t === doc.documentElement || t === doc.body) {
      box.style.display = "none";
      return;
    }
    const r = t.getBoundingClientRect();
    box.style.cssText += `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
  }

  function onClick(e: MouseEvent): void {
    const t = e.target;
    if (!(t instanceof Element) || isEditorUi(t)) return;
    // Capture phase: stop the page (links, buttons, trackers) from reacting.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    onPick(t);
  }

  return {
    start() {
      doc.addEventListener("mousemove", onMove, true);
      doc.addEventListener("click", onClick, true);
    },
    stop() {
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      box.style.display = "none";
    },
  };
}
