import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET } from "@/app/api/agent/v1/reports/summary/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["reports:read"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("contacts/c1").set({ subAccountId: "subMain", pipelineStage: "new", emailOptedOut: false, tags: [] });
  fakeDb.doc("contacts/c2").set({ subAccountId: "subMain", pipelineStage: "contacted", emailOptedOut: true, tags: [] });
  fakeDb.doc("contacts/c3").set({ subAccountId: "subOther", pipelineStage: "new", emailOptedOut: false, tags: [] });
  fakeDb.doc("deals/d1").set({ subAccountId: "subMain", stageId: "qualified", value: 997 });
});

describe("agent reports summary", () => {
  it("aggregates contacts and deals for the sub-account", async () => {
    const res = await GET(
      new Request("http://test/api/agent/v1/reports/summary?subAccountId=subMain", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.contacts).toEqual({
      total: 2,
      byStage: { new: 1, contacted: 1 },
      emailOptedOut: 1,
    });
    expect(data.deals).toEqual({
      total: 1,
      byStage: { qualified: 1 },
      valueByStage: { qualified: 997 },
    });
  });

  it("returns 400 VALIDATION_FAILED when subAccountId is missing", async () => {
    const res = await GET(
      new Request("http://test/api/agent/v1/reports/summary", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("buckets null pipelineStage and missing stageId under 'none'", async () => {
    fakeDb.doc("contacts/c4").set({ subAccountId: "subMain", pipelineStage: null, emailOptedOut: false, tags: [] });
    fakeDb.doc("deals/d2").set({ subAccountId: "subMain", value: 100 });
    const res = await GET(
      new Request("http://test/api/agent/v1/reports/summary?subAccountId=subMain", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.contacts.byStage.none).toBe(1);
    expect(data.deals.byStage.none).toBe(1);
    expect(data.deals.valueByStage.none).toBe(100);
  });

  it("counts non-numeric deal values as 0 without poisoning the stage sum", async () => {
    fakeDb.doc("deals/d2").set({ subAccountId: "subMain", stageId: "won", value: "997" });
    fakeDb.doc("deals/d3").set({ subAccountId: "subMain", stageId: "won", value: 500 });
    const res = await GET(
      new Request("http://test/api/agent/v1/reports/summary?subAccountId=subMain", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.deals.byStage.won).toBe(2);
    expect(data.deals.valueByStage.won).toBe(500);
  });
});
