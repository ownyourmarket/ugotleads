import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { POST } from "@/app/api/agent/v1/deals/route";
import { PATCH } from "@/app/api/agent/v1/deals/[id]/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["deals:write"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("contacts/c1").set({
    name: "Ann", subAccountId: "subMain", agencyId: "ag1", tags: [],
    emailOptedOut: false, smsOptedOut: false,
  });
});

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/deals", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent deals", () => {
  it("creates a deal with defaults", async () => {
    const res = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "DFY $997" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const deal = (await fakeDb.doc(`deals/${id}`).get()).data()!;
    expect(deal).toMatchObject({
      title: "DFY $997", value: 0, currency: "USD", contactId: "c1",
      stageId: "new", priority: "medium", agencyId: "ag1", subAccountId: "subMain",
      lostReason: null,
    });
    expect(deal.createdByUid).toMatch(/^agent:/);
  });

  it("404s when the contact is missing or in another sub-account", async () => {
    const res = await POST(post({ subAccountId: "subMain", contactId: "ghost", title: "X" }));
    expect(res.status).toBe(404);
  });

  it("rejects POST with numeric title (hardening: no crash on type mismatch)", async () => {
    const res = await POST(post({ subAccountId: "subMain", contactId: "c1", title: 42 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("moves stage, stamps stageChangedAt, writes contact activity", async () => {
    const createRes = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "D" }));
    const { id } = (await createRes.json()).data;
    const res = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ stageId: "qualified" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect((await res.json()).data.stageId).toBe("qualified");
    const deal = (await fakeDb.doc(`deals/${id}`).get()).data()!;
    expect(deal.stageChangedAt).toBeDefined();
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.docs.some((d) => d.data()?.type === "pipeline_moved")).toBe(true);
  });

  it("rejects an invalid stageId", async () => {
    const createRes = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "D" }));
    const { id } = (await createRes.json()).data;
    const res = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ stageId: "warp" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("ignores a non-string, non-null lostReason (hardening: no raw JSON write)", async () => {
    const createRes = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "D" }));
    const { id } = (await createRes.json()).data;
    const res = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ lostReason: 42 }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const deal = (await fakeDb.doc(`deals/${id}`).get()).data()!;
    expect(deal.lostReason).toBe(null);
  });

  it("trims a string lostReason", async () => {
    const createRes = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "D" }));
    const { id } = (await createRes.json()).data;
    const res = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ stageId: "lost", lostReason: "  too pricey  " }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const deal = (await fakeDb.doc(`deals/${id}`).get()).data()!;
    expect(deal.lostReason).toBe("too pricey");
  });
});
