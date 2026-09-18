/**
 * Mirrors the actual JSON shapes hub/apps/api's routes return (raw Drizzle
 * rows, camelCase) — NOT @tcw/shared's curated TestSummary/VariantSummary,
 * which are for the WP-facing runtime config, a different shape entirely.
 */

export interface Site {
  id: string;
  domain: string;
  displayName: string;
  siteKey: string;
  wpVersion: string | null;
  pluginVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface SiteCredentials {
  siteKey: string;
  siteSecret: string;
}

export type TestStatus =
  | "draft"
  | "qa"
  | "running"
  | "winner_found"
  | "inconclusive"
  | "awaiting_decision"
  | "finalising"
  | "archived";

export interface Test {
  id: string;
  siteId: string;
  name: string;
  type: "page" | "element";
  status: TestStatus;
  wpPostId: number;
  wpPostType: "post" | "page";
  wpPermalink: string;
  trafficSplit: number;
  minSampleSize: number;
  minRunDays: number;
  confidenceThreshold: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Variant {
  id: string;
  testId: string;
  key: string;
  label: string;
  isControl: boolean;
  trafficWeight: number;
  wpPostId: number | null;
  previewUrl: string | null;
  createdAt: string;
}

export interface VariantResult {
  variantId: string;
  key: string;
  label: string;
  isControl: boolean;
  sessions: number;
  avgActiveSeconds: number;
  avgScrollDepthPct: number;
  clickRate: number;
  rageClicks: number;
}

export interface TestResults {
  test: { id: string; name: string; status: TestStatus; startedAt: string | null };
  results: VariantResult[];
  note: string;
}
