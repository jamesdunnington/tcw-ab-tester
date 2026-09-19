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

/** Single, non-empty selector. Comma lists are rejected so one bad op can't hide the wrong elements. */
const selector = z
  .string()
  .min(1)
  .max(500)
  .refine((s) => !s.includes(",") && !/[{};]/.test(s), "selector must be a single CSS selector");

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
]);

export const changeOpsSchema = z.array(changeOpSchema).max(200);

export type ChangeOp = z.infer<typeof changeOpSchema>;
export type ChangeOps = z.infer<typeof changeOpsSchema>;
