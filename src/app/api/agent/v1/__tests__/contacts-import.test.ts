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

  it("skips a null row as invalid_row without crashing, and still processes the rest", async () => {
    const res = await POST(
      post({
        subAccountId: "subMain",
        contacts: [null, { name: "Good", phone: "+14045550199" }],
      }),
    );
    expect(res.status).toBe(201);
    const { created, skipped } = (await res.json()).data;
    expect(created).toBe(1);
    expect(skipped).toEqual([{ index: 0, reason: "invalid_row" }]);
  });

  it("imports a row with a numeric email field, storing email as empty string, without crashing", async () => {
    const res = await POST(
      post({
        subAccountId: "subMain",
        contacts: [{ email: 42, phone: "+14045550101" }],
      }),
    );
    expect(res.status).toBe(201);
    const { created, skipped } = (await res.json()).data;
    expect(created).toBe(1);
    expect(skipped).toEqual([]);
    const all = await fakeDb.collection("contacts").get();
    expect(all.docs[0].data()?.email).toBe("");
  });

  it("skips a row with only a numeric email field as missing_email_and_phone", async () => {
    const res = await POST(
      post({
        subAccountId: "subMain",
        contacts: [{ email: 42 }],
      }),
    );
    expect(res.status).toBe(201);
    const { created, skipped } = (await res.json()).data;
    expect(created).toBe(0);
    expect(skipped).toEqual([{ index: 0, reason: "missing_email_and_phone" }]);
  });
});
