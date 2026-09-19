/**
 * The full engagement tracker. Loaded as a normal (deferred/async) external
 * script from the hub — unlike runtime-inline.ts it does NOT need to run
 * before paint, so a network fetch is fine here. Reads the contexts
 * runtime-inline.ts already decided (window.__TCWAB__) and starts
 * collecting engagement-only signals per docs/PLAN.md section 4: no page
 * views, just active time, scroll, hover, click.
 */

import type { TcwabActiveContext } from "./runtime-inline.js";

type TrackerEventType =
  | "pageview"
  | "heartbeat"
  | "scroll_depth"
  | "scroll_stop"
  | "hover"
  | "click"
  | "rage_click"
  | "visibility_end";

interface QueuedEvent {
  testId: string;
  variantKey: string;
  visitorId: string;
  sessionId: string;
  device: TcwabActiveContext["device"];
  type: TrackerEventType;
  ts: number;
  url: string;
  data?: Record<string, unknown>;
}

const HEARTBEAT_MS = 5000;
const SCROLL_STOP_IDLE_MS = 1500;
const HOVER_MIN_MS = 500;
const RAGE_CLICK_WINDOW_MS = 1000;
const RAGE_CLICK_THRESHOLD = 3;
const RAGE_CLICK_RADIUS_PX = 40;
const FLUSH_INTERVAL_MS = 5000;

function main(): void {
  const rawContexts = window.__TCWAB__;
  if (!rawContexts || rawContexts.length === 0) return;
  const contexts: TcwabActiveContext[] = rawContexts;

  const queue: QueuedEvent[] = [];
  let lastActivityAt = Date.now();
  let maxScrollPct = 0;
  let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
  const recentClicks: Array<{ x: number; y: number; ts: number }> = [];
  const url = location.href;

  function emit(type: TrackerEventType, data?: Record<string, unknown>): void {
    for (const ctx of contexts as TcwabActiveContext[]) {
      queue.push({
        testId: ctx.testId,
        variantKey: ctx.variantKey,
        visitorId: ctx.visitorId,
        sessionId: ctx.sessionId,
        device: ctx.device,
        type,
        ts: Date.now(),
        url,
        data,
      });
    }
  }

  function markActivity(): void {
    lastActivityAt = Date.now();
  }

  function currentScrollPct(): number {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    if (scrollable <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round(((window.scrollY || doc.scrollTop) / scrollable) * 100)));
  }

  function onScroll(): void {
    markActivity();
    const pct = currentScrollPct();
    if (pct > maxScrollPct) {
      maxScrollPct = pct;
      if (maxScrollPct % 10 < 1 || maxScrollPct === 100) {
        emit("scroll_depth", { pct: maxScrollPct });
      }
    }
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => emit("scroll_stop", { pct: currentScrollPct() }), SCROLL_STOP_IDLE_MS);
  }

  function onClick(e: MouseEvent): void {
    markActivity();
    const target = e.target as Element | null;
    const goalEl = target?.closest("[data-tcwab-goal]");
    emit("click", { goal: goalEl?.getAttribute("data-tcwab-goal") ?? null, x: e.clientX, y: e.clientY });

    const now = Date.now();
    recentClicks.push({ x: e.clientX, y: e.clientY, ts: now });
    while (recentClicks.length && now - recentClicks[0].ts > RAGE_CLICK_WINDOW_MS) recentClicks.shift();
    const cluster = recentClicks.filter(
      (c) => Math.hypot(c.x - e.clientX, c.y - e.clientY) <= RAGE_CLICK_RADIUS_PX,
    );
    if (cluster.length >= RAGE_CLICK_THRESHOLD) {
      emit("rage_click", { count: cluster.length });
      recentClicks.length = 0; // one rage-click event per cluster
    }
  }

  // Delegated, so goal elements the change-op observer creates later are tracked too.
  function setupHoverTracking(): void {
    let hoverEl: Element | null = null;
    let enterAt = 0;
    const goalOf = (t: EventTarget | null) => (t instanceof Element ? t.closest("[data-tcwab-goal]") : null);
    document.addEventListener("mouseover", (e) => {
      const el = goalOf(e.target);
      if (el && el !== hoverEl) {
        hoverEl = el;
        enterAt = Date.now();
      }
    }, true);
    document.addEventListener("mouseout", (e) => {
      if (!hoverEl) return;
      const to = e.relatedTarget;
      if (to instanceof Node && hoverEl.contains(to)) return; // still inside the goal element
      const durationMs = Date.now() - enterAt;
      const goal = hoverEl.getAttribute("data-tcwab-goal");
      hoverEl = null;
      enterAt = 0;
      if (durationMs >= HOVER_MIN_MS) emit("hover", { goal, durationMs });
    }, true);
  }

  function flush(final: boolean): void {
    if (queue.length === 0) return;
    const consent = contexts.some((c) => c.consent);
    const batch = { events: queue.splice(0, queue.length), consent };
    const ingestUrl = contexts[0].ingestUrl;
    const siteKey = contexts[0].siteKey;
    const body = JSON.stringify(batch);

    if (final && navigator.sendBeacon) {
      const beaconUrl = ingestUrl + (ingestUrl.indexOf("?") === -1 ? "?" : "&") + "sk=" + encodeURIComponent(siteKey);
      navigator.sendBeacon(beaconUrl, new Blob([body], { type: "application/json" }));
      return;
    }

    fetch(ingestUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tcw-site-key": siteKey },
      body,
      keepalive: true,
    }).catch(() => {
      /* best-effort — a dropped analytics batch is not worth retry complexity in phase 1 */
    });
  }

  ["scroll", "touchmove"].forEach((evt) => window.addEventListener(evt, onScroll, { passive: true }));
  ["mousemove", "keydown", "touchstart"].forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }));
  window.addEventListener("click", onClick, true);
  setupHoverTracking();

  emit("pageview");
  onScroll(); // capture initial scroll depth (e.g. anchor-linked loads)

  setInterval(() => {
    const idleMs = Date.now() - lastActivityAt;
    if (document.visibilityState === "visible" && idleMs < HEARTBEAT_MS) {
      emit("heartbeat", { deltaMs: HEARTBEAT_MS });
    }
    flush(false);
  }, Math.min(HEARTBEAT_MS, FLUSH_INTERVAL_MS));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      emit("visibility_end", { maxScrollPct });
      flush(true);
    }
  });
  window.addEventListener("pagehide", () => {
    emit("visibility_end", { maxScrollPct });
    flush(true);
  });
}

main();
