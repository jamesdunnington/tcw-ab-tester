/**
 * Statistics consent, read live in the visitor's browser (docs/PLAN.md section 3).
 *
 * It must NOT be decided when WordPress renders the page: the rendered HTML (with its config) is what a
 * page cache stores, so a server-side answer would freeze the first visitor's choice for everyone.
 * The server only supplies the fallback (`fallback`): what to assume when no consent tool has said anything.
 *
 * First definite answer wins:
 *   1. WP Consent API   window.wp_has_consent("statistics"), or its wp_consent_statistics cookie
 *   2. Complianz        cmplz_statistics cookie ("allow" / "deny")
 *   3. CookieYes        cookieyes-consent cookie ("...,analytics:yes,...")
 *   4. the fallback
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

export function hasStatisticsConsent(fallback: boolean): boolean {
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
