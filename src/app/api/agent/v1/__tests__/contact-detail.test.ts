import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET, PATCH } from "@/app/api/agent/v1/contacts/[id]/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["contacts:read", "contacts:write"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("contacts/c1").set({
    name: "Ann", email: "a@ex.com", phone: "", company: "", tags: ["box1"],
    pipelineStage: "new", agencyId: "ag1", subAccountId: "subMain",
    emailOptedOut: false, smsOptedOut: false,
  });
  fakeDb.doc("contacts/cForeign").set({
    name: "X", email: "x@ex.com", tags: [], pipelineStage: "new",
    agencyId: "ag1", subAccountId: "subOther", emailOptedOut: false, smsOptedOut: false,
  });
});

function patch(id: string, body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://test/api/agent/v1/contacts/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

describe("agent contact detail", () => {
  it("gets a contact in an allowed sub-account", async () => {
    const res = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe("Ann");
  });

  it("404s for a contact outside the allowlist (indistinguishable from missing)", async () => {
    const foreign = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "cForeign" }) },
    );
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe("NOT_FOUND");
    const missing = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("adds and removes tags in one call", async () => {
    const res = await PATCH(...patch("c1", { addTags: ["box1", "warm"], removeTags: ["box1"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.tags).toEqual(["warm"]);
  });

  it("moves pipeline stage and writes a pipeline_moved activity", async () => {
    const res = await PATCH(...patch("c1", { pipelineStage: "contacted" }));
    expect((await res.json()).data.pipelineStage).toBe("contacted");
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.size).toBe(1);
    expect(acts.docs[0].data()?.type).toBe("pipeline_moved");
    expect(acts.docs[0].data()?.createdBy).toMatch(/^agent:/);
  });

  it("rejects an unknown pipeline stage", async () => {
    const res = await PATCH(...patch("c1", { pipelineStage: "galaxy" }));
    expect(res.status).toBe(400);
  });

  it("rejects addTags with non-string items (hardening)", async () => {
    const res = await PATCH(...patch("c1", { addTags: [123] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("does not crash on non-string email, leaves it unchanged (hardening)", async () => {
    const res = await PATCH(...patch("c1", { email: 42 }));
    expect(res.status).toBe(200);
    const stored = await fakeDb.doc("contacts/c1").get();
    expect(stored.data()?.email).toBe("a@ex.com");
  });

  it("does not crash on non-string name, leaves it unchanged (hardening)", async () => {
    const res = await PATCH(...patch("c1", { name: 42 }));
    expect(res.status).toBe(200);
    const after = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect((await after.json()).data.name).toBe("Ann");
  });
});
