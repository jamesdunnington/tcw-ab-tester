import { EditorApi, type EditorBoot } from "./api.js";
import { OpStore } from "./ops.js";
import { createPicker, mountOverlay } from "./picker.js";
import { PreviewRenderer } from "./preview.js";
import { buildSelector, fingerprint } from "./selector.js";
import { Sidebar } from "./ui.js";

/**
 * Visual editor entry. Loaded by the WordPress plugin's editor bridge only for
 * a verified hub admin (see wp-plugin includes/class-editor-bridge.php), which
 * sets window.__TCWAB_EDITOR__ first.
 */
declare global {
  interface Window {
    __TCWAB_EDITOR__?: EditorBoot;
  }
}

/** Approximate device preview: narrows the page. Media queries still follow the real window. */
function setPageWidth(px: number | null): void {
  const s = document.documentElement.style;
  s.maxWidth = px ? `${px}px` : "";
  s.marginLeft = s.marginRight = px ? "auto" : "";
}

async function boot(): Promise<void> {
  const cfg = window.__TCWAB_EDITOR__;
  if (!cfg) return;

  const overlay = mountOverlay();
  const api = new EditorApi(cfg);

  let initial: Awaited<ReturnType<EditorApi["loadOps"]>> = [];
  let loadError = "";
  try {
    initial = await api.loadOps();
  } catch (e) {
    loadError = (e as Error).message;
  }

  const store = new OpStore(initial);
  const preview = new PreviewRenderer();
  preview.render(store.ops);
  store.subscribe(() => preview.render(store.ops));

  const sidebar = new Sidebar(overlay.root, store, {
    variantKey: cfg.variantKey,
    // Never save over edits we failed to load: that would silently erase them.
    onSave: () => (loadError ? Promise.reject(new Error("saved edits could not be loaded")) : api.saveOps(store.ops)),
    onWidth: setPageWidth,
  });
  if (loadError) sidebar.setStatus(`Could not load saved edits: ${loadError}. Saving is disabled until you reopen the editor.`, true);

  api.onAuthLost = (reason) => sidebar.setStatus(`Editor session ended (${reason}). Save your work by reopening the editor from the hub.`, true);
  api.startRenewing();

  createPicker(overlay, (el) => {
    sidebar.select({
      selector: buildSelector(el),
      fp: fingerprint(el),
      tag: el.tagName.toLowerCase(),
      hasChildren: el.children.length > 0,
      text: (el.textContent ?? "").trim(),
      href: el.getAttribute("href") ?? "",
    });
  }).start();

  document.addEventListener("keydown", (e) => {
    const typing = e.composedPath().some((n) => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    if (typing || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  });

  window.addEventListener("beforeunload", (e) => {
    if (store.dirty) e.preventDefault();
  });
}

void boot();
