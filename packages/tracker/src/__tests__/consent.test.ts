// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hasStatisticsConsent } from "../consent.js";

function clearCookies() {
  for (const c of document.cookie.split("; ")) {
    if (c) document.cookie = `${c.split("=")[0]}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}
afterEach(() => {
  clearCookies();
  delete (window as any).wp_has_consent;
});

describe("hasStatisticsConsent", () => {
  it("uses the fallback when no consent tool has said anything", () => {
    expect(hasStatisticsConsent(false)).toBe(false);
    expect(hasStatisticsConsent(true)).toBe(true);
  });

  it("WP Consent API function wins over everything", () => {
    document.cookie = "cmplz_statistics=deny; path=/";
    (window as any).wp_has_consent = (c: string) => c === "statistics";
    expect(hasStatisticsConsent(false)).toBe(true);
    (window as any).wp_has_consent = () => false;
    document.cookie = "cmplz_statistics=allow; path=/";
    expect(hasStatisticsConsent(true)).toBe(false);
  });

  it("falls back to the WP Consent API cookie", () => {
    document.cookie = "wp_consent_statistics=allow; path=/";
    expect(hasStatisticsConsent(false)).toBe(true);
    document.cookie = "wp_consent_statistics=deny; path=/";
    expect(hasStatisticsConsent(true)).toBe(false);
  });

  it("reads Complianz allow and deny", () => {
    document.cookie = "cmplz_statistics=allow; path=/";
    expect(hasStatisticsConsent(false)).toBe(true);
    document.cookie = "cmplz_statistics=deny; path=/";
    expect(hasStatisticsConsent(true)).toBe(false);
  });

  it("reads CookieYes analytics, plain or URL-encoded", () => {
    document.cookie = "cookieyes-consent=consentid:abc,consent:yes,action:yes,necessary:yes,functional:yes,analytics:yes,advertisement:no; path=/";
    expect(hasStatisticsConsent(false)).toBe(true);
    clearCookies();
    document.cookie = "cookieyes-consent=" + encodeURIComponent("consentid:abc,consent:yes,analytics:no,advertisement:no") + "; path=/";
    expect(hasStatisticsConsent(true)).toBe(false);
  });

  it("a CookieYes cookie with no analytics field does not decide; the fallback applies", () => {
    document.cookie = "cookieyes-consent=consentid:abc,consent:no; path=/";
    expect(hasStatisticsConsent(true)).toBe(true);
  });

  it("does not mistake another category for analytics", () => {
    document.cookie = "cookieyes-consent=necessary:yes,nonanalytics:yes; path=/";
    expect(hasStatisticsConsent(false)).toBe(false);
  });
});
