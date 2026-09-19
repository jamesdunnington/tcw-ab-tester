import { buildSelector, fingerprint } from "./selector.js";
import { mountOverlay, createPicker } from "./picker.js";

/**
 * Visual editor entry. Loaded by the WordPress plugin's editor bridge only for
 * a verified hub admin (see wp-plugin includes/class-editor-bridge.php), which
 * sets window.__TCWAB_EDITOR__ first.
 */
interface EditorBoot {
  hubUrl: string;
  siteKey: string;
  testId: string;
  variantKey: string;
  token: string;
  expiresAt: number;
}

declare global {
  interface Window {
    __TCWAB_EDITOR__?: EditorBoot;
  }
}

function boot(): void {
  const cfg = window.__TCWAB_EDITOR__;
  if (!cfg) return;

  const overlay = mountOverlay();
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;left:12px;bottom:12px;max-width:min(420px,90vw);padding:10px 12px;border-radius:8px;" +
    "background:#0f172a;color:#f8fafc;font:13px/1.4 system-ui,sans-serif;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,.3);";
  bar.textContent = `Editing variant ${cfg.variantKey.toUpperCase()} - click any element`;
  overlay.root.appendChild(bar);

  const picker = createPicker(overlay, (el) => {
    const selector = buildSelector(el);
    const fp = fingerprint(el);
    bar.textContent = `Selected: ${selector}`;
    window.dispatchEvent(new CustomEvent("tcwab:pick", { detail: { selector, fp } }));
  });
  picker.start();
}

boot();
