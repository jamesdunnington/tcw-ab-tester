/**
 * The synchronous, inline assignment script. WordPress's
 * includes/class-runtime.php echoes the compiled output of this file
 * directly inside a <script> tag in <head> — NOT as an external src=
 * reference — right after a small <script> setting window.__TCWAB_CONFIG__.
 *
 * Why inline: a page-test variant decision has to happen before first
 * paint, with zero network round trips, or the visitor sees a content
 * flash/flicker (or worse, a delayed redirect). Because the config JSON is
 * baked into the cached HTML itself, this keeps working under full-page
 * caching/CDNs (see docs/PLAN.md section 3).
 *
 * Kept dependency-free and deliberately small — budget is <2KB inline
 * (docs/PLAN.md section 12).
 */

import type { ChangeOp } from "@tcw/shared";
import { runOps } from "./applier.js";

interface TcwabVariantConfig {
  key: string;
  weight: number;
  isControl: boolean;
  redirectUrl?: string;
  /** Element tests: DOM change operations applied for this variant (see @tcw/shared change-ops). */
  ops?: ChangeOp[];
}

interface TcwabTestConfig {
  testId: string;
  variants: TcwabVariantConfig[];
}

interface TcwabConfig {
  /** Decided element tests: the winning ops, applied to every visitor with no assignment and no tracking. */
  rules?: ChangeOp[][];
  ingestUrl: string;
  /**
   * The hub PUBLIC site key. Never the hub internal site UUID - the
   * browser/WordPress side never knows that; the hub resolves it itself
   * from this key on every /ingest call (see docs/PLAN.md section 4 and
   * hub/apps/api/src/routes/ingest.ts).
   */
  siteKey: string;
  tests: TcwabTestConfig[];
  consent: boolean;
}

export interface TcwabActiveContext {
  siteKey: string;
  testId: string;
  variantKey: string;
  visitorId: string;
  sessionId: string;
  device: "desktop" | "tablet" | "mobile";
  ingestUrl: string;
  consent: boolean;
}

declare global {
  interface Window {
    __TCWAB_CONFIG__?: TcwabConfig;
    __TCWAB__?: TcwabActiveContext[];
  }
}

function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministic 0-99 bucket from a string, so the same visitor+test always lands in the same bucket. */
function bucketOf(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function deviceClass(): "desktop" | "tablet" | "mobile" {
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function pickVariant(visitorId: string, test: TcwabTestConfig): TcwabVariantConfig | null {
  const bucket = bucketOf(visitorId + ":" + test.testId);
  let cumulative = 0;
  for (const v of test.variants) {
    cumulative += v.weight;
    if (bucket < cumulative) return v;
  }
  return test.variants.find((v) => v.isControl) ?? test.variants[0] ?? null;
}

(function init() {
  const cfg = window.__TCWAB_CONFIG__;
  if (!cfg) return;
  if (cfg.rules) for (const r of cfg.rules) runOps(r);
  if (!cfg.tests || cfg.tests.length === 0) return;

  const visitorId = getCookie("tcwab_vid") ?? uuidv4();
  setCookie("tcwab_vid", visitorId, 365);

  // Session cookie: no explicit expiry, so it dies with the browser session.
  let sessionId = getCookie("tcwab_sid");
  if (!sessionId) {
    sessionId = uuidv4();
    document.cookie = `tcwab_sid=${encodeURIComponent(sessionId)}; path=/; SameSite=Lax`;
  }

  const contexts: TcwabActiveContext[] = [];

  for (const test of cfg.tests) {
    const assignCookieName = "tcwab_asg_" + test.testId;
    let assignedKey = getCookie(assignCookieName);
    let variant = assignedKey ? test.variants.find((v) => v.key === assignedKey) : undefined;

    if (!variant) {
      variant = pickVariant(visitorId, test) ?? undefined;
      if (!variant) continue;
      setCookie(assignCookieName, variant.key, 90);
      assignedKey = variant.key;
    }

    if (!variant.isControl && variant.redirectUrl && location.href.indexOf(variant.redirectUrl) === -1) {
      location.replace(variant.redirectUrl);
      return; // one redirect per page load is enough; the new load re-runs this script
    }

    if (variant.ops && variant.ops.length) runOps(variant.ops);

    contexts.push({
      siteKey: cfg.siteKey,
      testId: test.testId,
      variantKey: assignedKey as string,
      visitorId,
      sessionId: sessionId as string,
      device: deviceClass(),
      ingestUrl: cfg.ingestUrl,
      consent: cfg.consent,
    });
  }

  window.__TCWAB__ = contexts;
})();
