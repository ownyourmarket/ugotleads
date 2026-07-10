import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { POST, GET } from "@/app/api/agent/v1/contacts/route";

let KEY: string;

function seedKey() {
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1",
    label: "t",
    keyHash: gen.keyHash,
    keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"],
    scopes: ["contacts:read", "contacts:write"],
    status: "active",
  });
  KEY = gen.key;
}

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/contacts", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(qs: string): Request {
  return new Request(`http://test/api/agent/v1/contacts?${qs}`, {
    headers: { authorization: `Bearer ${KEY}` },
  });
}

describe("agent contacts", () => {
  beforeEach(() => {
    resetFakeDb();
    seedKey();
  });

  it("creates a contact with agent-stamped defaults", async () => {
    const res = await POST(
      post({ subAccountId: "subMain", name: "Ann", email: "Ann@Ex.com", tags: ["box1"] }),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const doc = (await fakeDb.doc(`contacts/${id}`).get()).data()!;
    expect(doc).toMatchObject({
      name: "Ann",
      email: "ann@ex.com",
      agencyId: "ag1",
      subAccountId: "subMain",
      tags: ["box1"],
      pipelineStage: "new",
      emailOptedOut: false,
      smsOptedOut: false,
    });
    expect(doc.createdByUid).toMatch(/^agent:ugl_/);
  });

  it("requires email or phone", async () => {
    const res = await POST(post({ subAccountId: "subMain", name: "NoContact" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("409s on duplicate email within the sub-account", async () => {
    await POST(post({ subAccountId: "subMain", email: "dup@ex.com" }));
    const res = await POST(post({ subAccountId: "subMain", email: "dup@ex.com" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.existingId).toBeDefined();
  });

  it("searches by tag within the allowed sub-account", async () => {
    await POST(post({ subAccountId: "subMain", email: "a@ex.com", tags: ["box1"] }));
    await POST(post({ subAccountId: "subMain", email: "b@ex.com", tags: [] }));
    const res = await GET(get("subAccountId=subMain&tag=box1"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe("a@ex.com");
  });

  it("403s when searching a sub-account outside the allowlist", async () => {
    const res = await GET(get("subAccountId=subOther"));
    expect(res.status).toBe(403);
  });

  it("400s when tags contains non-string values", async () => {
    const res = await POST(post({ subAccountId: "subMain", email: "t@ex.com", tags: [123] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("403s when creating in a sub-account outside the allowlist", async () => {
    const res = await POST(post({ subAccountId: "subOther", email: "x@ex.com" }));
    expect(res.status).toBe(403);
  });

  it("400s when email is a non-string and no phone is given", async () => {
    const res = await POST(post({ subAccountId: "subMain", email: 42 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });
});
