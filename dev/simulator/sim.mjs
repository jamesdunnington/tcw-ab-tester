// Dev-only traffic simulator: posts synthetic visitors to the real /ingest endpoint.
// The challenger (b) has a built-in advantage so the stats engine has something to find.
import { randomUUID } from "node:crypto";

const HUB = "http://host.docker.internal:4000";
const ORIGIN = "http://host.docker.internal:8080";
const SITE_KEY = process.env.SITE_KEY;
const TEST_ID = process.env.TEST_ID;
const N = Number(process.env.N ?? 120);
// ELEMENT=1: an element test has one URL for both arms, so the challenger does not get its own page.
const ELEMENT = process.env.ELEMENT === "1";

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const profile = {
  a: { click: 0.1, scroll: [15, 65], beats: [1, 5], url: `${ORIGIN}/sample-page/` },
  b: { click: 0.22, scroll: [35, 95], beats: [2, 8], url: ELEMENT ? `${ORIGIN}/sample-page/` : `${ORIGIN}/sample-page-2/` },
};

let stored = 0;
const codes = {};
for (let i = 0; i < N; i++) {
  const key = i % 2 === 0 ? "a" : "b";
  const p = profile[key];
  const base = { testId: TEST_ID, variantKey: key, visitorId: randomUUID(), sessionId: randomUUID(), device: "desktop", url: p.url };
  const t0 = Date.now() - Math.floor(rand() * 60_000);
  const events = [{ ...base, type: "pageview", ts: t0 }];
  const beats = p.beats[0] + Math.floor(rand() * (p.beats[1] - p.beats[0] + 1));
  for (let b = 1; b <= beats; b++) events.push({ ...base, type: "heartbeat", ts: t0 + b * 5000, data: { deltaMs: 5000 } });
  events.push({ ...base, type: "scroll_depth", ts: t0 + 4000, data: { pct: Math.round(p.scroll[0] + rand() * (p.scroll[1] - p.scroll[0])) } });
  if (rand() < p.click) events.push({ ...base, type: "click", ts: t0 + 6000, data: { sel: "a.wp-block-button__link", ox: 40, oy: 50, dead: false } });

  const res = await fetch(`${HUB}/ingest?sk=${SITE_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ consent: true, events }),
  });
  codes[res.status] = (codes[res.status] ?? 0) + 1;
  if (res.status === 200 || res.status === 202) {
    const j = await res.json().catch(() => ({}));
    stored += j.stored ?? 0;
  }
}
console.log(JSON.stringify({ visitors: N, statusCodes: codes, eventsStored: stored }));
