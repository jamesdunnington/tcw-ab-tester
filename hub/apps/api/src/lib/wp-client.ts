import { signRequest, type ChangeOp } from "@tcw/shared";
import { decryptSecret } from "./crypto.js";
import type { SiteRow } from "./hmac-guard.js";

/**
 * Hub -> WordPress signed HTTP client. Mirror of hmac-guard.ts but for the
 * other direction: the hub is the caller here, WordPress's
 * includes/class-rest-api.php verifies these signatures the same way
 * hmac-guard.ts verifies inbound WP requests.
 */

export class WpClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

async function wpRequest<T>(site: SiteRow, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const secret = decryptSecret(site.secretEncrypted);
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  const signed = signRequest({ method, path, body: bodyStr, secret });

  const url = new URL(path, normalizeDomain(site.domain)).toString();
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-tcw-site-key": site.siteKey,
      "x-tcw-timestamp": signed.timestamp,
      "x-tcw-nonce": signed.nonce,
      "x-tcw-signature": signed.signature,
    },
    body: body === undefined ? undefined : bodyStr,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const parsed = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    throw new WpClientError(`WP request failed: ${method} ${path} -> ${res.status}`, res.status, parsed);
  }
  return parsed as T;
}

function normalizeDomain(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
}

export interface DuplicatePostResult {
  variantWpPostId: number;
  previewUrl: string;
}

/** Asks WordPress to create a draft/private copy of `sourcePostId` for use as a test variant. */
export async function requestVariantDuplicate(
  site: SiteRow,
  args: { testId: string; variantKey: string; sourcePostId: number; label: string },
): Promise<DuplicatePostResult> {
  return wpRequest<DuplicatePostResult>(site, "POST", "/wp-json/tcwab/v1/variants", args);
}

export interface RuntimeConfigPushEntry {
  testId: string;
  type: "page" | "element";
  status: string;
  wpPostId: number;
  variants: Array<{ key: string; weight: number; isControl: boolean; redirectUrl?: string; ops?: ChangeOp[] }>;
}

/** Pushes the full active-test config for a site so WP can inject the runtime snippet immediately. */
export async function pushRuntimeConfig(site: SiteRow, tests: RuntimeConfigPushEntry[]): Promise<void> {
  await wpRequest(site, "POST", "/wp-json/tcwab/v1/config", { tests });
}

export interface WpPostInfo {
  id: number;
  type: "post" | "page";
  title: string;
  permalink: string;
  wordCount: number;
}

/** Fetches canonical post metadata from WP so the hub never has to trust client-supplied post type/permalink. */
export async function fetchPostInfo(site: SiteRow, wpPostId: number): Promise<WpPostInfo> {
  return wpRequest<WpPostInfo>(site, "GET", `/wp-json/tcwab/v1/posts/${wpPostId}`);
}

export interface FinalizePayload {
  testId: string;
  testName: string;
  sourcePostId: number;
  chosenKey: string;
  deleteRedundant: boolean;
  startedAt: string | null;
  /** Element tests: the winning change set (goals stripped), stored as a permanent rule with no tracking. */
  permanentOps?: ChangeOp[];
  variants: Array<{ key: string; postId: number | null; isControl: boolean }>;
}

export interface FinalizeManifest {
  promoted: boolean;
  permanentRule?: boolean;
  revisionSaved: boolean;
  deleted: unknown[];
  retired: number[];
  errors: Array<{ postId: number; error: string }>;
}

/** One signed call that promotes the winner, then deletes/retires the copies, on the WP side. */
export async function finalizeTest(site: SiteRow, payload: FinalizePayload): Promise<FinalizeManifest> {
  return wpRequest<FinalizeManifest>(site, "POST", "/wp-json/tcwab/v1/finalize", payload);
}
