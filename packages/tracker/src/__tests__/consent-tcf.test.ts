// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (data: unknown, ok: boolean) => void;

/** A fake IAB TCF CMP: records the listener so a test can play "the visitor answered the banner". */
function installCmp(): { answer: (data: unknown, ok?: boolean) => void; calls: number } {
  const state = {
    listener: null as Listener | null,
    calls: 0,
    answer(data: unknown, ok = true) {
      state.listener?.(data, ok);
    },
  };
  (window as any).__tcfapi = (command: string, _version: number, cb: Listener) => {
    state.calls++;
    if (command === "addEventListener") state.listener = cb;
  };
  return state;
}

async function freshConsent() {
  vi.resetModules(); // the module keeps the CMP's latest answer
  return (await import("../consent.js")).hasStatisticsConsent;
}

beforeEach(() => {
  delete (window as any).__tcfapi;
  delete (window as any).wp_has_consent;
});
afterEach(() => {
  delete (window as any).__tcfapi;
});

describe("hasStatisticsConsent with an IAB TCF banner (AdSense / Mediavine)", () => {
  it("with no banner on the page the fallback decides, so an unbannered visitor is tracked when the fallback is true", async () => {
    const has = await freshConsent();
    expect(has(true)).toBe(true);
    expect(has(false)).toBe(false);
  });

  it("a banner that has not been answered yet means no consent, whatever the fallback says", async () => {
    installCmp();
    const has = await freshConsent();
    expect(has(true)).toBe(false);
  });

  it("outside the regulated regions (gdprApplies false) the visitor is tracked", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true); // subscribes
    cmp.answer({ gdprApplies: false });
    expect(has(false)).toBe(true);
  });

  it("consent to storage (1) and content measurement (8) allows tracking", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true);
    cmp.answer({ gdprApplies: true, purpose: { consents: { "1": true, "8": true } } });
    expect(has(false)).toBe(true);
  });

  it("refusing measurement, or storage, blocks tracking", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true);
    cmp.answer({ gdprApplies: true, purpose: { consents: { "1": true, "8": false } } });
    expect(has(true)).toBe(false);
    cmp.answer({ gdprApplies: true, purpose: { consents: { "1": false, "8": true } } });
    expect(has(true)).toBe(false);
  });

  it("a regulated visitor who has not chosen (no purposes yet) is not tracked", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true);
    cmp.answer({ gdprApplies: true, purpose: { consents: {} } });
    expect(has(true)).toBe(false);
  });

  it("follows the visitor changing their mind", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true);
    cmp.answer({ gdprApplies: true, purpose: { consents: { "1": true, "8": true } } });
    expect(has(false)).toBe(true);
    cmp.answer({ gdprApplies: true, purpose: { consents: { "1": false, "8": false } } });
    expect(has(true)).toBe(false);
  });

  it("subscribes once, however often consent is read", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true);
    has(true);
    has(true);
    expect(cmp.calls).toBe(1);
  });

  it("a CMP that throws counts as no answer, not as consent", async () => {
    (window as any).__tcfapi = () => {
      throw new Error("cmp broke");
    };
    const has = await freshConsent();
    expect(has(true)).toBe(false);
  });

  it("an error reply from the CMP (ok = false) is ignored, not read as consent", async () => {
    const cmp = installCmp();
    const has = await freshConsent();
    has(true);
    cmp.answer({ gdprApplies: false }, false);
    expect(has(true)).toBe(false);
  });
});
