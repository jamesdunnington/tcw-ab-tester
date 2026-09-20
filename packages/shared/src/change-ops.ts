import { z } from "zod";

/**
 * Typed change operations: what the visual editor produces and the browser
 * runtime applies for element tests (docs/PLAN.md section 7). One variant's
 * `change_ops` is an array of these.
 *
 * Every op is addressed by a CSS selector. `fp` is the editor's fallback
 * fingerprint (tag + text + position) used to re-find the element when a theme
 * change breaks the selector; the runtime ignores it, the editor uses it.
 */

/**
 * AdSense and Mediavine place ads by script inside the page. Their policies forbid changing or hiding an ad
 * container, so an op aimed at one is refused. Matches a selector's text, so it catches the common ad classes and ids.
 */
export const AD_SLOT_PATTERN = /adsbygoogle|google_ads|google-auto-placed|googlesyndication|doubleclick|mv-ads|mv_slot|mediavine|mv-video/i;

/** Single, non-empty selector. Comma lists are rejected so one bad op can't hide the wrong elements. */
const selector = z
  .string()
  .min(1)
  .max(500)
  .refine((s) => !s.includes(",") && !/[{};]/.test(s), "selector must be a single CSS selector")
  .refine((s) => !AD_SLOT_PATTERN.test(s), "selector targets an ad container, which ad networks do not allow to be changed");

const fingerprint = z
  .object({ tag: z.string().max(32), text: z.string().max(120), index: z.number().int().min(0) })
  .optional();

/** CSS property names the editor may set (kebab-case), values are plain strings. */
const styleProp = z.string().regex(/^-?[a-z][a-z-]*$/).max(64);
const styleValue = z
  .string()
  .max(300)
  .refine((v) => !/[;{}]|url\s*\(|expression\s*\(|javascript:/i.test(v), "unsafe css value");

/** Attributes the editor may set. Event handlers and inline style are excluded (use the style op). */
const attrName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(40)
  .refine((n) => !n.startsWith("on") && n !== "style" && n !== "srcdoc", "attribute not allowed");
const attrValue = z
  .string()
  .max(2000)
  .refine((v) => !/^\s*(javascript|data|vbscript):/i.test(v), "unsafe url scheme");

const base = { selector, fp: fingerprint };

export const changeOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("text"), ...base, value: z.string().max(5000) }),
  z.object({ op: z.literal("html"), ...base, value: z.string().max(20000) }),
  z.object({
    op: z.literal("style"),
    ...base,
    styles: z.record(styleProp, styleValue).refine((s) => Object.keys(s).length > 0 && Object.keys(s).length <= 40),
  }),
  z.object({ op: z.literal("attr"), ...base, name: attrName, value: attrValue }),
  z.object({ op: z.literal("hide"), ...base }),
  /** Marks the element as a conversion goal: sets data-tcwab-goal so the tracker reports its clicks/hovers. */
  z.object({ op: z.literal("goal"), ...base, name: z.string().regex(/^[a-z0-9_-]{1,40}$/i) }),
]);

export const changeOpsSchema = z.array(changeOpSchema).max(200);

export type ChangeOp = z.infer<typeof changeOpSchema>;
export type ChangeOps = z.infer<typeof changeOpsSchema>;

/**
 * Goals describe what counts as a conversion, so they must exist on every
 * variant, including the control (which has no edits of its own). Returns one
 * ops list per input list: its own non-goal ops plus the de-duplicated union
 * of goal ops from all variants.
 */
export function mergeGoalOps(opsByVariant: ChangeOp[][]): ChangeOp[][] {
  const goals = new Map<string, ChangeOp>();
  for (const ops of opsByVariant) {
    for (const o of ops) if (o.op === "goal") goals.set(`${o.selector}\u0000${o.name}`, o);
  }
  const shared = [...goals.values()];
  return opsByVariant.map((ops) => [...ops.filter((o) => o.op !== "goal"), ...shared]);
}

/** Body for creating an element test: same targeting as a page test, no variant post is duplicated. */
export const createElementTestSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().min(1).max(160).optional(),
  wpPostId: z.number().int().positive(),
  trafficSplit: z.number().min(1).max(99).default(50),
  minSampleSize: z.number().int().positive().default(200),
  minRunDays: z.number().int().min(1).max(60).default(7),
  confidenceThreshold: z.number().min(0.5).max(0.999).default(0.95),
});
export type CreateElementTestInput = z.infer<typeof createElementTestSchema>;
