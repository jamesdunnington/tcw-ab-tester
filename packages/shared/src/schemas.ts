import { z } from "zod";

export const testTypeSchema = z.enum(["page", "element"]);

export const testStatusSchema = z.enum([
  "draft",
  "qa",
  "running",
  "winner_found",
  "inconclusive",
  "awaiting_decision",
  "finalising",
  "archived",
]);

export const deviceClassSchema = z.enum(["desktop", "tablet", "mobile"]);

/** Body WordPress sends to register/heartbeat itself with the hub. */
export const siteRegisterSchema = z.object({
  domain: z.string().min(3),
  displayName: z.string().min(1).max(120),
  wpVersion: z.string().optional(),
  pluginVersion: z.string().optional(),
});

/** Body the dashboard sends to create a new page/post split test. */
export const createPageTestSchema = z.object({
  siteId: z.string().uuid(),
  /** Falls back to the WP post title (fetched from WP at creation time) when omitted. */
  name: z.string().min(1).max(160).optional(),
  wpPostId: z.number().int().positive(),
  /** wpPostType/wpPermalink are NOT client-supplied - the hub fetches them live from WP
   *  at creation time (lib/wp-client.ts fetchPostInfo) so the dashboard only needs a post ID. */
  trafficSplit: z.number().min(1).max(99).default(50),
  minSampleSize: z.number().int().positive().default(200),
  minRunDays: z.number().int().min(1).max(60).default(7),
  confidenceThreshold: z.number().min(0.5).max(0.999).default(0.95),
});

export const trackerEventTypeSchema = z.enum([
  "pageview",
  "heartbeat",
  "scroll_depth",
  "scroll_stop",
  "hover",
  "click",
  "rage_click",
  "visibility_end",
]);

/** Wire format from the browser — no siteId, see @tcw/shared types.ts TrackerEventPayload for why. */
export const trackerEventSchema = z.object({
  testId: z.string().uuid(),
  variantKey: z.string().min(1).max(32),
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  device: deviceClassSchema,
  type: trackerEventTypeSchema,
  ts: z.number().int().positive(),
  url: z.string().url(),
  data: z.record(z.unknown()).optional(),
});

export const queuedTrackerEventSchema = trackerEventSchema.extend({ siteId: z.string().uuid() });

export const ingestBatchSchema = z.object({
  events: z.array(trackerEventSchema).min(1).max(200),
  consent: z.boolean(),
});

/** Envelope every signed WP <-> hub request/response body is wrapped in. */
export const signedEnvelopeHeaders = z.object({
  "x-tcw-site-key": z.string().min(8),
  "x-tcw-timestamp": z.string(),
  "x-tcw-nonce": z.string().min(8),
  "x-tcw-signature": z.string().min(16),
});

export type CreatePageTestInput = z.infer<typeof createPageTestSchema>;
export type SiteRegisterInput = z.infer<typeof siteRegisterSchema>;
export type TrackerEventInput = z.infer<typeof trackerEventSchema>;
export type QueuedTrackerEventInput = z.infer<typeof queuedTrackerEventSchema>;
export type IngestBatchInput = z.infer<typeof ingestBatchSchema>;

/** The owner's final call on a finished test (docs/PLAN.md section 6). */
export const decisionInputSchema = z.object({
  /** Which variant to end up with: "a" keeps the original, any other key applies that variant to it. */
  chosenVariantKey: z.string().min(1).max(32),
  deleteRedundant: z.boolean(),
  /** Optional, but required by the API when overriding the stats engine's recommendation. */
  reason: z.string().max(1000).optional(),
});

export type DecisionInput = z.infer<typeof decisionInputSchema>;
