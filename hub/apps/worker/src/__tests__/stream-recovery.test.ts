import { describe, expect, it, vi } from "vitest";
import { reclaimStale, type Outcome } from "../stream-recovery.js";

const S = "tcw:ingest:events";
const G = "tcw-workers";

/** A stand-in for the few Redis stream commands the recovery uses; `pages` are XAUTOCLAIM replies in order. */
function fakeRedis(pages: Array<[string, Array<[string, string[]]>]>, deliveries: Record<string, number> = {}) {
  let call = 0;
  return {
    xautoclaim: vi.fn(async (..._args: unknown[]) => pages[call++] ?? ["0-0", []]),
    xpending: vi.fn(async (_s: string, _g: string, id: string) => [[id, "old-worker", 61_000, deliveries[id] ?? 2]]),
    xack: vi.fn(async () => 1),
    xdel: vi.fn(async () => 1),
    xadd: vi.fn(async () => "1-0"),
  };
}

const entry = (id: string): [string, string[]] => [id, ["payload", `{"n":"${id}"}`]];
const opts = (handle: (id: string) => Promise<Outcome>) => ({ stream: S, group: G, consumer: "worker-2", handle });

describe("reclaimStale", () => {
  it("finishes entries a crashed worker left behind, then acks and deletes them", async () => {
    const r = fakeRedis([["0-0", [entry("1-0"), entry("2-0")]]]);
    const handle = vi.fn(async () => "done" as Outcome);
    const res = await reclaimStale(r as never, opts(handle));

    expect(res).toEqual({ done: 2, retried: 0, deadLettered: 0 });
    expect(handle).toHaveBeenCalledTimes(2);
    expect(r.xack).toHaveBeenCalledWith(S, G, "1-0", "2-0");
    expect(r.xdel).toHaveBeenCalledWith(S, "1-0", "2-0"); // acked entries must also leave the stream
  });

  it("leaves an entry pending when storing it failed, so it is tried again later", async () => {
    const r = fakeRedis([["0-0", [entry("1-0"), entry("2-0")]]]);
    const res = await reclaimStale(r as never, opts(async (id) => (id === "1-0" ? "retry" : "done")));

    expect(res).toEqual({ done: 1, retried: 1, deadLettered: 0 });
    expect(r.xack).toHaveBeenCalledWith(S, G, "2-0"); // only the finished one
  });

  it("parks an entry in the dead-letter stream after too many attempts, without handling it again", async () => {
    const r = fakeRedis([["0-0", [entry("1-0")]]], { "1-0": 6 });
    const handle = vi.fn(async () => "retry" as Outcome);
    const res = await reclaimStale(r as never, { ...opts(handle), maxAttempts: 5 });

    expect(res).toEqual({ done: 0, retried: 0, deadLettered: 1 });
    expect(handle).not.toHaveBeenCalled();
    expect(r.xadd).toHaveBeenCalledWith(`${S}:dead`, "*", "id", "1-0", "payload", '{"n":"1-0"}', "reason", "gave up after 5 attempts");
    expect(r.xack).toHaveBeenCalledWith(S, G, "1-0");
    expect(r.xdel).toHaveBeenCalledWith(S, "1-0");
  });

  it("keeps going through every page until the cursor comes back to the start", async () => {
    const r = fakeRedis([["5-0", [entry("1-0")]], ["9-0", [entry("5-0")]], ["0-0", [entry("9-0")]]]);
    const res = await reclaimStale(r as never, opts(async () => "done"));

    expect(res.done).toBe(3);
    expect(r.xautoclaim).toHaveBeenCalledTimes(3);
    expect(r.xautoclaim.mock.calls.map((c) => c[4])).toEqual(["0-0", "5-0", "9-0"]);
  });

  it("does nothing when there is nothing idle, and does not fail when the group does not exist yet", async () => {
    const empty = fakeRedis([["0-0", []]]);
    expect(await reclaimStale(empty as never, opts(async () => "done"))).toEqual({ done: 0, retried: 0, deadLettered: 0 });
    expect(empty.xack).not.toHaveBeenCalled();

    const noGroup = fakeRedis([]);
    noGroup.xautoclaim.mockRejectedValue(new Error("NOGROUP"));
    expect(await reclaimStale(noGroup as never, opts(async () => "done"))).toEqual({ done: 0, retried: 0, deadLettered: 0 });
  });
});
