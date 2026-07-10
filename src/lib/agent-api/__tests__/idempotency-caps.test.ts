import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { withIdempotency } from "@/lib/agent-api/idempotency";
import { enforceDailyCap } from "@/lib/agent-api/caps";

function req(idemKey?: string): Request {
  return new Request("http://test/x", {
    method: "POST",
    headers: idemKey ? { "idempotency-key": idemKey } : {},
  });
}

describe("withIdempotency", () => {
  beforeEach(resetFakeDb);

  it("runs the handler every time without a key", async () => {
    let calls = 0;
    const handler = async () => ({ status: 201, body: { data: { n: ++calls } } });
    await withIdempotency(req(), "key1", handler);
    const res = await withIdempotency(req(), "key1", handler);
    expect(calls).toBe(2);
    expect((await res.json()).data.n).toBe(2);
  });

  it("replays the stored response for a repeated key", async () => {
    let calls = 0;
    const handler = async () => ({ status: 201, body: { data: { n: ++calls } } });
    const first = await withIdempotency(req("abc"), "key1", handler);
    const second = await withIdempotency(req("abc"), "key1", handler);
    expect(calls).toBe(1);
    expect(second.status).toBe(201);
    expect((await second.json())).toEqual(await first.json());
    expect(second.headers.get("x-idempotent-replay")).toBe("true");
  });

  it("scopes idempotency per service key", async () => {
    let calls = 0;
    const handler = async () => ({ status: 200, body: { data: { n: ++calls } } });
    await withIdempotency(req("abc"), "key1", handler);
    await withIdempotency(req("abc"), "key2", handler);
    expect(calls).toBe(2);
  });

  it("a preflight returning a response short-circuits the handler and stores nothing", async () => {
    let calls = 0;
    const handler = async () => ({ status: 200, body: { data: { n: ++calls } } });
    const preflight = vi.fn(async () => NextResponse.json({ error: { code: "CAP_EXCEEDED" } }, { status: 429 }));

    const res = await withIdempotency(req("fresh-key"), "key1", handler, { preflight });
    expect(res.status).toBe(429);
    expect(calls).toBe(0);
    expect(preflight).toHaveBeenCalledTimes(1);

    // Nothing should be stored — a blocked preflight must remain retryable.
    const all = await fakeDb.collection("agentIdempotency").get();
    expect(all.size).toBe(0);
  });

  it("preflight is not called on a replay hit", async () => {
    let calls = 0;
    const handler = async () => ({ status: 200, body: { data: { n: ++calls } } });
    const preflight = vi.fn(async () => null);

    await withIdempotency(req("replay-key"), "key1", handler, { preflight });
    expect(preflight).toHaveBeenCalledTimes(1);

    const res = await withIdempotency(req("replay-key"), "key1", handler, { preflight });
    expect(res.headers.get("x-idempotent-replay")).toBe("true");
    expect(calls).toBe(1);
    // Preflight only ran once — on the fresh call, not the replay.
    expect(preflight).toHaveBeenCalledTimes(1);
  });
});

describe("enforceDailyCap", () => {
  beforeEach(resetFakeDb);

  it("allows up to the limit then returns 429 with Retry-After", async () => {
    expect(await enforceDailyCap("key1", "sends", 2)).toBeNull();
    expect(await enforceDailyCap("key1", "sends", 2)).toBeNull();
    const blocked = await enforceDailyCap("key1", "sends", 2);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(Number(blocked!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked!.json()).error.code).toBe("CAP_EXCEEDED");
  });
});
