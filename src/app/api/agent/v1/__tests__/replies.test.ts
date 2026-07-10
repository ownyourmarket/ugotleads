import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET } from "@/app/api/agent/v1/replies/route";
import { PATCH } from "@/app/api/agent/v1/replies/[id]/route";

let KEY: string;

function seedData() {
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1",
    label: "t",
    keyHash: gen.keyHash,
    keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"],
    scopes: ["replies:read", "replies:write"],
    status: "active",
  });
  KEY = gen.key;

  // r1: subMain, handled false, contactId "c1", fromEmail "p@ex.com", subject "Re: hi", text "yes"
  fakeDb.doc("inbound_emails/r1").set({
    id: "r1",
    agencyId: "ag1",
    subAccountId: "subMain",
    contactId: "c1",
    fromEmail: "p@ex.com",
    fromRaw: "p@ex.com",
    to: ["test@example.com"],
    subject: "Re: hi",
    text: "yes",
    html: null,
    resendEmailId: null,
    messageId: null,
    handled: false,
    matchedBy: "email_lookup",
    receivedAt: new Date("2026-01-10T10:00:00Z"),
    createdAt: new Date("2026-01-10T10:00:00Z"),
  });

  // r2: subMain, handled true
  fakeDb.doc("inbound_emails/r2").set({
    id: "r2",
    agencyId: "ag1",
    subAccountId: "subMain",
    contactId: "c2",
    fromEmail: "q@ex.com",
    fromRaw: "q@ex.com",
    to: ["test@example.com"],
    subject: "Re: hi",
    text: "ok",
    html: null,
    resendEmailId: null,
    messageId: null,
    handled: true,
    matchedBy: "email_lookup",
    receivedAt: new Date("2026-01-10T11:00:00Z"),
    createdAt: new Date("2026-01-10T11:00:00Z"),
  });

  // rX: subOther, handled false
  fakeDb.doc("inbound_emails/rX").set({
    id: "rX",
    agencyId: "ag1",
    subAccountId: "subOther",
    contactId: "cx",
    fromEmail: "x@ex.com",
    fromRaw: "x@ex.com",
    to: ["test@example.com"],
    subject: "Other",
    text: "no",
    html: null,
    resendEmailId: null,
    messageId: null,
    handled: false,
    matchedBy: null,
    receivedAt: new Date("2026-01-10T12:00:00Z"),
    createdAt: new Date("2026-01-10T12:00:00Z"),
  });

  // rNull: subAccountId null, handled false
  fakeDb.doc("inbound_emails/rNull").set({
    id: "rNull",
    agencyId: null,
    subAccountId: null,
    contactId: null,
    fromEmail: "null@ex.com",
    fromRaw: "null@ex.com",
    to: ["test@example.com"],
    subject: "Unmatched",
    text: "unmatched",
    html: null,
    resendEmailId: null,
    messageId: null,
    handled: false,
    matchedBy: null,
    receivedAt: new Date("2026-01-10T13:00:00Z"),
    createdAt: new Date("2026-01-10T13:00:00Z"),
  });
}

function get(qs: string): Request {
  return new Request(`http://test/api/agent/v1/replies?${qs}`, {
    headers: { authorization: `Bearer ${KEY}` },
  });
}

function patch(id: string, body: unknown): Request {
  return new Request(`http://test/api/agent/v1/replies/${id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("agent replies", () => {
  beforeEach(() => {
    resetFakeDb();
    seedData();
  });

  it("lists only subMain docs with correct field allow-list", async () => {
    const res = await GET(get("subAccountId=subMain"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    // Verify both r1 and r2 are present
    const ids = body.data.map((d: Record<string, unknown>) => d.id).sort();
    expect(ids).toEqual(["r1", "r2"]);
    // Verify field allow-list
    const reply = body.data[0];
    expect(Object.keys(reply).sort()).toEqual(
      [
        "contactId",
        "fromEmail",
        "handled",
        "id",
        "matchedBy",
        "receivedAt",
        "subject",
        "text",
      ].sort()
    );
  });

  it("filters by handled=false", async () => {
    const res = await GET(get("subAccountId=subMain&handled=false"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("r1");
    expect(body.data[0].handled).toBe(false);
  });

  it("400s without subAccountId", async () => {
    const res = await GET(get(""));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("403s when accessing a sub-account outside the allowlist", async () => {
    const res = await GET(get("subAccountId=subOther"));
    expect(res.status).toBe(403);
  });

  it("PATCHes r1 to mark handled", async () => {
    const res = await PATCH(patch("r1", { handled: true }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: "r1", handled: true });
    // Verify fakeDb doc was updated
    const doc = (await fakeDb.doc("inbound_emails/r1").get()).data();
    expect(doc?.handled).toBe(true);
  });

  it("404s when PATCHing rX (foreign tenant)", async () => {
    const res = await PATCH(patch("rX", { handled: true }), {
      params: Promise.resolve({ id: "rX" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("404s when PATCHing rNull (null subAccountId)", async () => {
    const res = await PATCH(patch("rNull", { handled: true }), {
      params: Promise.resolve({ id: "rNull" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("400s when PATCH body.handled is not a boolean", async () => {
    const res = await PATCH(patch("r1", { handled: "yes" }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });
});
