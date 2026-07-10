import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { POST } from "@/app/api/agent/v1/contacts/import/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["contacts:write"], status: "active",
  });
  KEY = gen.key;
});

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/contacts/import", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent contacts import", () => {
  it("creates valid rows, skips invalid + duplicate rows with reasons", async () => {
    fakeDb.doc("contacts/existing").set({ subAccountId: "subMain", email: "dup@ex.com", tags: [] });
    const res = await POST(
      post({
        subAccountId: "subMain",
        contacts: [
          { name: "A", email: "a@ex.com", tags: ["box1"] },
          { name: "PhoneOnly", phone: "+14045550100" },
          { name: "Bad", email: "not-an-email" },
          { name: "Dup", email: "dup@ex.com" },
          { name: "Empty" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const { created, skipped } = (await res.json()).data;
    expect(created).toBe(2);
    expect(skipped).toEqual([
      { index: 2, reason: "invalid_email" },
      { index: 3, reason: "duplicate_email" },
      { index: 4, reason: "missing_email_and_phone" },
    ]);
  });

  it("rejects more than 200 rows", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ phone: `+1404555${i}` }));
    const res = await POST(post({ subAccountId: "subMain", contacts: rows }));
    expect(res.status).toBe(400);
  });
});
