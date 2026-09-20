/**
 * Light is the default. Dark is only ever an explicit choice, remembered per browser.
 * Storage can throw (private windows, blocked site data), so every access is guarded
 * and the page still renders in light without it.
 */
export type Theme = "light" | "dark";

const KEY = "tcw-theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* not remembered, still applied */
  }
}

export function applyStoredTheme(): Theme {
  const theme = readTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}
