/**
 * Statistics consent, read live in the visitor's browser (docs/PLAN.md section 3).
 *
 * It must NOT be decided when WordPress renders the page: the rendered HTML (with its config) is what a
 * page cache stores, so a server-side answer would freeze the first visitor's choice for everyone.
 * The server only supplies the fallback (`fallback`): what to assume when no consent tool has said anything.
 *
 * First definite answer wins:
 *   0. IAB TCF banner   window.__tcfapi (AdSense/Google, Mediavine). If a banner is present its answer is final,
 *                       and "not answered yet" means no consent, never the fallback.
 *   1. WP Consent API   window.wp_has_consent("statistics"), or its wp_consent_statistics cookie
 *   2. Complianz        cmplz_statistics cookie ("allow" / "deny")
 *   3. CookieYes        cookieyes-consent cookie ("...,analytics:yes,...")
 *   4. the fallback     (the plugin sets it to "track" when no tool has spoken; see class-runtime.php)
 */

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * IAB TCF (the banner AdSense/Google and Mediavine show). The CMP may load after us, so we subscribe once and
 * keep the latest answer. While a CMP is present but has not answered yet, that means NO consent (never a guess).
 *   - gdprApplies false (visitor outside the regulated regions): allowed.
 *   - otherwise purpose 1 (store/access on device) AND purpose 8 (measure content performance) must be granted.
 */
type TcfData = { gdprApplies?: boolean; purpose?: { consents?: Record<string, boolean> } };
type TcfApi = (command: string, version: number, cb: (data: TcfData, ok: boolean) => void) => void;
let tcfAnswer: boolean | null = null;
let tcfSubscribed = false;

function tcfState(): boolean | null | "absent" {
  const api = (window as unknown as { __tcfapi?: TcfApi }).__tcfapi;
  if (typeof api !== "function") return "absent";
  if (!tcfSubscribed) {
    tcfSubscribed = true;
    try {
      api("addEventListener", 2, (d, ok) => {
        if (!ok || !d) return;
        const c = d.purpose?.consents;
        tcfAnswer = d.gdprApplies === false || !!(c && c["1"] && c["8"]);
      });
    } catch {
      /* a broken CMP counts as "no answer" */
    }
  }
  return tcfAnswer;
}

export function hasStatisticsConsent(fallback: boolean): boolean {
  const tcf = tcfState();
  if (tcf !== "absent") return tcf === true;
  const w = window as unknown as { wp_has_consent?: (category: string) => boolean };
  if (typeof w.wp_has_consent === "function") {
    try {
      return !!w.wp_has_consent("statistics");
    } catch {
      /* fall through to the cookies */
    }
  }
  const wp = readCookie("wp_consent_statistics");
  if (wp) return wp === "allow";
  const cmplz = readCookie("cmplz_statistics");
  if (cmplz) return cmplz === "allow";
  const cookieyes = readCookie("cookieyes-consent");
  const answer = cookieyes && /(?:^|,)analytics:(yes|no)/.exec(cookieyes);
  if (answer) return answer[1] === "yes";
  return fallback;
}
