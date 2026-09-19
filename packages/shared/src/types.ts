/**
 * Shared domain types for the TCW A/B Tester hub, WordPress plugin bridge,
 * and dashboard. Kept dependency-free (no DB/framework types) so this
 * package can be imported by the API, worker, dashboard and tracker build.
 */

export type TestType = "page" | "element";

export type TestStatus =
  | "draft"
  | "qa"
  | "running"
  | "winner_found"
  | "inconclusive"
  | "awaiting_decision"
  | "finalising"
  | "archived";

export type DeviceClass = "desktop" | "tablet" | "mobile";

export interface VariantSummary {
  id: string;
  testId: string;
  /** "a" is always the original/control. "b", "c", ... are challengers. */
  key: string;
  label: string;
  /** For type "page": the WordPress post ID this variant renders (control re-uses the original post). */
  wpPostId?: number;
  /** For type "page": the variant's own preview URL on the WordPress site (before promotion). */
  previewUrl?: string;
  isControl: boolean;
  trafficWeight: number;
}

export interface TestSummary {
  id: string;
  siteId: string;
  name: string;
  type: TestType;
  status: TestStatus;
  /** Post ID on the WordPress site that this test targets (the control/original). */
  wpPostId: number;
  wpPostType: "post" | "page";
  wpPermalink: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  minSampleSize: number;
  minRunDays: number;
  confidenceThreshold: number;
  variants: VariantSummary[];
}

/** The minimal config the WordPress plugin needs to run active tests on a page. */
export interface RuntimeConfigEntry {
  testId: string;
  type: TestType;
  status: TestStatus;
  wpPostId: number;
  variants: Array<{
    key: string;
    weight: number;
    isControl: boolean;
    /** Only present for "page" tests — where to send the visitor. */
    redirectUrl?: string;
  }>;
}

export interface RuntimeConfigResponse {
  siteId: string;
  generatedAt: string;
  tests: RuntimeConfigEntry[];
}

export type TrackerEventType =
  | "pageview"
  | "heartbeat"
  | "scroll_depth"
  | "scroll_stop"
  | "hover"
  | "click"
  | "rage_click"
  | "section_view"
  | "visibility_end";

/**
 * The wire format the browser tracker sends to POST /ingest. Deliberately
 * has NO siteId — the browser only ever knows the public site_key (via
 * runtime-inline.ts), never the hub's internal UUID. The API resolves the
 * real site from the site_key (header or query param) and stamps siteId on
 * server side — see QueuedTrackerEvent below and hub/apps/api/src/routes/ingest.ts.
 */
export interface TrackerEventPayload {
  testId: string;
  variantKey: string;
  visitorId: string;
  sessionId: string;
  device: DeviceClass;
  type: TrackerEventType;
  ts: number;
  url: string;
  data?: Record<string, unknown>;
}

/** TrackerEventPayload + the server-verified siteId, as pushed onto the Redis ingest stream for the worker. */
export interface QueuedTrackerEvent extends TrackerEventPayload {
  siteId: string;
}

export interface IngestBatch {
  events: TrackerEventPayload[];
  consent: boolean;
}
