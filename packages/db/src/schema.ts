import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  bigserial,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Phase 1 schema. Covers: hub admin auth, site registration, page/post
 * split tests, visitor assignment, raw tracker events, and per-pageview
 * engagement rollups. Deliberately does NOT yet implement:
 *  - monthly partitioning of events (see docs/PLAN.md, section 8 - add via a
 *    raw-SQL migration once event volume justifies it; a plain indexed
 *    table is correct and fast enough for phase 1 traffic)
 *  - variants.change_ops consumers (element tests, phase 3)
 *  - decisions / library_items full winner-flow (phase 2)
 * Those columns/tables are included where cheap to add now so phase 2/3
 * migrations are additive, not destructive.
 */

export const testTypeEnum = pgEnum("test_type", ["page", "element"]);
export const testStatusEnum = pgEnum("test_status", [
  "draft",
  "qa",
  "running",
  "winner_found",
  "inconclusive",
  "awaiting_decision",
  "finalising",
  "archived",
]);
export const wpPostTypeEnum = pgEnum("wp_post_type", ["post", "page"]);
export const deviceEnum = pgEnum("device_class", ["desktop", "tablet", "mobile"]);
export const trackerEventTypeEnum = pgEnum("tracker_event_type", [
  "pageview",
  "heartbeat",
  "scroll_depth",
  "scroll_stop",
  "hover",
  "click",
  "rage_click",
  "visibility_end",
  "section_view",
]);
export const heatLayerEnum = pgEnum("heat_layer", ["click", "hover", "scroll", "attention", "rage", "dead"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex("users_email_idx").on(t.email),
}));

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull(),
  displayName: text("display_name").notNull(),
  siteKey: text("site_key").notNull(),
  /**
   * The site secret, AES-256-GCM encrypted at rest with SECRET_ENCRYPTION_KEY
   * (see src/lib/crypto.ts). Unlike a login password, this must be
   * *recoverable* — verifying an inbound HMAC signature (src/lib/hmac-guard.ts)
   * requires the raw secret to recompute the HMAC, which a one-way hash
   * cannot provide. Stored format: "<ivHex>:<authTagHex>:<ciphertextHex>".
   */
  secretEncrypted: text("secret_encrypted").notNull(),
  wpVersion: text("wp_version"),
  pluginVersion: text("plugin_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => ({
  siteKeyIdx: uniqueIndex("sites_site_key_idx").on(t.siteKey),
}));

export const tests = pgTable("tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: testTypeEnum("type").notNull().default("page"),
  status: testStatusEnum("status").notNull().default("draft"),
  wpPostId: integer("wp_post_id").notNull(),
  wpPostType: wpPostTypeEnum("wp_post_type").notNull().default("page"),
  wpPermalink: text("wp_permalink").notNull(),
  /** Word count of the original post, fetched from WP at creation; drives expected read time in the Engagement Score. */
  wordCount: integer("word_count").notNull().default(0),
  trafficSplit: integer("traffic_split").notNull().default(50),
  minSampleSize: integer("min_sample_size").notNull().default(200),
  minRunDays: integer("min_run_days").notNull().default(7),
  confidenceThreshold: numeric("confidence_threshold", { precision: 4, scale: 3 }).notNull().default("0.950"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /** Set when the "winner found" email went out, so an hourly recompute never sends it twice. */
  winnerNotifiedAt: timestamp("winner_notified_at", { withTimezone: true }),
}, (t) => ({
  siteIdx: index("tests_site_idx").on(t.siteId),
  statusIdx: index("tests_status_idx").on(t.status),
}));

export const variants = pgTable("variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // "a", "b", "c" ...
  label: text("label").notNull(),
  isControl: boolean("is_control").notNull().default(false),
  trafficWeight: integer("traffic_weight").notNull(),
  /** "page" tests: the WP post id this variant renders. Null for control (control = the test's own wpPostId). */
  wpPostId: integer("wp_post_id"),
  previewUrl: text("preview_url"),
  /** "element" tests (phase 3): serialized change-operation list. Unused in phase 1. */
  changeOps: jsonb("change_ops"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  testIdx: index("variants_test_idx").on(t.testId),
  testKeyIdx: uniqueIndex("variants_test_key_idx").on(t.testId, t.key),
}));

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
  visitorId: uuid("visitor_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  device: deviceEnum("device").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  testVisitorIdx: uniqueIndex("assignments_test_visitor_idx").on(t.testId, t.visitorId),
  testIdx: index("assignments_test_idx").on(t.testId),
}));

/** Raw tracker events, written by the worker after batched ingest from Redis. */
export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
  visitorId: uuid("visitor_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  device: deviceEnum("device").notNull(),
  type: trackerEventTypeEnum("type").notNull(),
  url: text("url").notNull(),
  data: jsonb("data"),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  testIdx: index("events_test_idx").on(t.testId),
  sessionIdx: index("events_session_idx").on(t.sessionId),
  tsIdx: index("events_ts_idx").on(t.ts),
}));

/** One row per (session, test) — rolled up by the worker from raw events. */
export const pageviews = pgTable("pageviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
  visitorId: uuid("visitor_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  device: deviceEnum("device").notNull(),
  activeMs: integer("active_ms").notNull().default(0),
  maxScrollPct: numeric("max_scroll_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  clicked: boolean("clicked").notNull().default(false),
  rageClicks: integer("rage_clicks").notNull().default(0),
  /** Key sections seen for >= 1s (section_view events) and how many the tracker observed; 0 total = no section data (older tracker). */
  sectionsSeen: integer("sections_seen").notNull().default(0),
  sectionsTotal: integer("sections_total").notNull().default(0),
  /** Computed once packages/stats lands (phase 2). Null in phase 1. */
  engagementScore: numeric("engagement_score", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  testVariantIdx: index("pageviews_test_variant_idx").on(t.testId, t.variantId),
  sessionTestIdx: uniqueIndex("pageviews_session_test_idx").on(t.sessionId, t.testId),
}));

/**
 * Heatmap aggregates (docs/PLAN.md sections 7 and 8), kept forever unlike raw events. One row per
 * (test, variant, device, layer, element selector, grid cell); the worker upserts into it.
 * click/rage/dead: cell = offset inside the element on a 10x10 grid. hover/attention: cell 0,0, the
 * element as a whole. scroll: selector "", cell_y = 5% band of page height.
 */
export const heatBins = pgTable("heat_bins", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
  device: deviceEnum("device").notNull(),
  layer: heatLayerEnum("layer").notNull(),
  selector: text("selector").notNull(),
  cellX: integer("cell_x").notNull().default(0),
  cellY: integer("cell_y").notNull().default(0),
  count: integer("count").notNull().default(0),
  /** hover: seconds hovered; attention: seconds in view; others: same as count. */
  weight: numeric("weight", { precision: 12, scale: 2 }).notNull().default("0"),
}, (t) => ({
  binIdx: uniqueIndex("heat_bins_bin_idx").on(t.testId, t.variantId, t.device, t.layer, t.selector, t.cellX, t.cellY),
}));

/**
 * The cross-site library (docs/PLAN.md section 10): every decided test is kept here permanently, with
 * enough to reuse the result on another site after the copy is gone from WordPress. The source test and
 * site are references that may disappear; the name and domain are copied so the item stays readable.
 */
export const libraryItems = pgTable("library_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").references(() => tests.id, { onDelete: "set null" }),
  sourceSiteId: uuid("source_site_id").references(() => sites.id, { onDelete: "set null" }),
  sourceDomain: text("source_domain").notNull(),
  name: text("name").notNull(),
  type: testTypeEnum("type").notNull(),
  wpPostType: wpPostTypeEnum("wp_post_type").notNull().default("page"),
  tags: jsonb("tags").notNull().default([]),
  /** "applied_variant" (a change won) or "kept_original" (the original held up). */
  outcome: text("outcome").notNull(),
  winnerKey: text("winner_key").notNull(),
  winnerLabel: text("winner_label").notNull(),
  /** Lift of the chosen variant over the original, percent, when the stats engine had one. */
  liftPct: numeric("lift_pct", { precision: 8, scale: 2 }),
  /** Probability the chosen variant was best at decision time, 0-1. */
  pBest: numeric("p_best", { precision: 5, scale: 4 }),
  sessions: integer("sessions").notNull().default(0),
  /** Element tests: the chosen variant's full change ops (goals included, so it can be re-run as a test). */
  changeOps: jsonb("change_ops"),
  /** Page tests: { [variantKey]: { label, isControl, title, content, excerpt } } taken before any copy was deleted. */
  snapshots: jsonb("snapshots"),
  /** The final stats snapshot (gates, per-variant analysis) so the numbers outlive the test. */
  finalStats: jsonb("final_stats"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  testIdx: uniqueIndex("library_items_test_idx").on(t.testId),
  typeIdx: index("library_items_type_idx").on(t.type),
}));

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** The user's final call on a finished test (docs/PLAN.md section 6): keep A or apply B, and whether to delete the redundant copy. */
export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  chosenVariantId: uuid("chosen_variant_id").notNull().references(() => variants.id),
  /** Variant the stats engine recommended, so overriding the recommendation is visible in the record. */
  recommendedVariantKey: text("recommended_variant_key"),
  deleteRedundant: boolean("delete_redundant").notNull(),
  reason: text("reason"),
  decidedBy: uuid("decided_by").references(() => users.id),
  /** What WordPress reported deleting/promoting, kept permanently even after the copy is gone. */
  cleanupManifest: jsonb("cleanup_manifest"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  testIdx: uniqueIndex("decisions_test_idx").on(t.testId),
}));

/** Hourly stats results, kept for the confidence-over-time trend and as the permanent archive of final numbers. */
export const statsSnapshots = pgTable("stats_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(),
  winnerKey: text("winner_key"),
  /** Full WinnerDecision from @tcw/stats: gates, per-variant analysis, SRM. */
  result: jsonb("result").notNull(),
}, (t) => ({
  testComputedIdx: index("stats_snapshots_test_computed_idx").on(t.testId, t.computedAt),
}));

/**
 * OAuth for the Claude connector (hub/apps/mcp). Additive tables only. Codes and tokens are stored
 * as SHA-256 hashes: a database leak must not hand out working credentials.
 */
export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  /** AES-GCM encrypted (same box as site secrets): the SDK compares the secret in plaintext, so it must be recoverable. Null for public (PKCE-only) clients. */
  clientSecretEncrypted: text("client_secret_encrypted"),
  /** The RFC 7591 registration document: redirect_uris, client_name, token_endpoint_auth_method ... */
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use authorization codes (10 minutes). Consumed by delete-and-return, so a replay finds nothing. */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scopes: jsonb("scopes").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Access (about 1 hour) and refresh tokens. A refresh token is single use; reusing one revokes its whole family. */
export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  kind: text("kind").notNull(), // "access" | "refresh"
  familyId: uuid("family_id").notNull(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scopes: jsonb("scopes").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: uniqueIndex("oauth_tokens_hash_idx").on(t.tokenHash),
  familyIdx: index("oauth_tokens_family_idx").on(t.familyId),
}));
