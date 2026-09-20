/**
 * The full engagement tracker. Loaded as a normal (deferred/async) external
 * script from the hub — unlike runtime-inline.ts it does NOT need to run
 * before paint, so a network fetch is fine here. Reads the contexts
 * runtime-inline.ts already decided (window.__TCWAB__) and starts
 * collecting engagement-only signals per docs/PLAN.md section 4: no page
 * views, just active time, scroll, hover, click.
 */

import type { TcwabActiveContext } from "./runtime-inline.js";
import { buildSelector } from "../../editor/src/selector.js";
import { hasStatisticsConsent } from "./consent.js";

type TrackerEventType =
  | "pageview"
  | "heartbeat"
  | "scroll_depth"
  | "scroll_stop"
  | "hover"
  | "click"
  | "rage_click"
  | "visibility_end"
  | "section_view";

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
const SECTION_DWELL_MS = 1000;
const SECTION_MAX_OBSERVED = 40;
const SECTION_SCAN_DELAY_MS = 1500;
/** Elements a click is expected to do something on; a click anywhere else is a "dead" click. */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[onclick],[tabindex],[data-tcwab-goal]";
/** Elements whose hover counts as intent: things you can act on. */
const HOVERABLE = "a,button,input,select,summary,[role=button],[data-tcwab-goal]";
const SECTIONS = "h1,h2,h3,section,[data-tcwab-goal]";

/** Where inside the element a pointer landed, as integer percent (0-100), so a map still lines up when the layout reflows. */
function offsetPct(el: Element, x: number, y: number): { ox: number; oy: number } {
  const r = el.getBoundingClientRect();
  const pct = (v: number, size: number) => (size > 0 ? Math.max(0, Math.min(100, Math.round((v / size) * 100))) : 0);
  return { ox: pct(x - r.left, r.width), oy: pct(y - r.top, r.height) };
}

function safeSelector(el: Element): string {
  try {
    return buildSelector(el).slice(0, 300);
  } catch {
    return "";
  }
}

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
    const where = target ? { sel: safeSelector(target), ...offsetPct(target, e.clientX, e.clientY) } : {};
    emit("click", {
      goal: goalEl?.getAttribute("data-tcwab-goal") ?? null,
      x: e.clientX,
      y: e.clientY,
      ...where,
      ...(target && !target.closest(INTERACTIVE) ? { dead: true } : {}),
    });

    const now = Date.now();
    recentClicks.push({ x: e.clientX, y: e.clientY, ts: now });
    while (recentClicks.length && now - recentClicks[0].ts > RAGE_CLICK_WINDOW_MS) recentClicks.shift();
    const cluster = recentClicks.filter(
      (c) => Math.hypot(c.x - e.clientX, c.y - e.clientY) <= RAGE_CLICK_RADIUS_PX,
    );
    if (cluster.length >= RAGE_CLICK_THRESHOLD) {
      emit("rage_click", { count: cluster.length, ...where });
      recentClicks.length = 0; // one rage-click event per cluster
    }
  }

  // Delegated, so goal elements the change-op observer creates later are tracked too.
  function setupHoverTracking(): void {
    let hoverEl: Element | null = null;
    let enterAt = 0;
    const hoverTarget = (t: EventTarget | null) => (t instanceof Element ? t.closest(HOVERABLE) : null);
    document.addEventListener("mouseover", (e) => {
      const el = hoverTarget(e.target);
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
      const goal = hoverEl.closest("[data-tcwab-goal]")?.getAttribute("data-tcwab-goal") ?? null;
      const sel = durationMs >= HOVER_MIN_MS ? safeSelector(hoverEl) : "";
      hoverEl = null;
      enterAt = 0;
      if (durationMs >= HOVER_MIN_MS) emit("hover", { goal, durationMs, sel });
    }, true);
  }

  // Which key sections were actually looked at: >= 50% (or a viewport-filling half) in view for >= 1s, once per element.
  function setupSectionTracking(): void {
    if (typeof IntersectionObserver === "undefined") return;
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const seen = new Set<Element>();
    let total = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          const visible = entry.isIntersecting && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= window.innerHeight * 0.5);
          if (visible && !seen.has(el) && !timers.has(el)) {
            timers.set(
              el,
              setTimeout(() => {
                seen.add(el);
                timers.delete(el);
                io.unobserve(el);
                emit("section_view", { sel: safeSelector(el), ms: SECTION_DWELL_MS, total });
              }, SECTION_DWELL_MS),
            );
          } else if (!visible && timers.has(el)) {
            clearTimeout(timers.get(el));
            timers.delete(el);
          }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    const scan = () => {
      const found = Array.from(document.querySelectorAll(SECTIONS)).filter((el) => (el as HTMLElement).offsetHeight > 0);
      const picked = found.slice(0, SECTION_MAX_OBSERVED);
      total = picked.length;
      for (const el of picked) io.observe(el);
    };
    // Late-rendering themes and builders: look once the page has settled, not at first paint.
    const start = () => setTimeout(scan, SECTION_SCAN_DELAY_MS);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
  }

  function flush(final: boolean): void {
    if (queue.length === 0) return;
    // Live, not the value baked into the (possibly cached) page: consent may have been given or withdrawn since load.
    const consent = hasStatisticsConsent(contexts.some((c) => c.consent));
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
  setupSectionTracking();

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
