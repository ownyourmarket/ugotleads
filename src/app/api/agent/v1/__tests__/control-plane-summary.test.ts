import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET } from "@/app/api/agent/v1/control-plane/summary/route";

let KEY: string;
let NO_SCOPE_KEY: string;

function seedData() {
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1",
    label: "cp",
    keyHash: gen.keyHash,
    keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"],
    scopes: ["control_plane:read"],
    status: "active",
  });
  KEY = gen.key;

  const gen2 = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key2").set({
    agencyId: "ag1",
    label: "crm-only",
    keyHash: gen2.keyHash,
    keyPrefix: gen2.keyPrefix,
    allowedSubAccounts: ["subMain"],
    scopes: ["contacts:read"],
    status: "active",
  });
  NO_SCOPE_KEY = gen2.key;

  fakeDb.doc("products/p1").set({
    agencyId: "ag1",
    name: "CRM Pro",
    status: "active",
    isPublic: true,
    accessModel: "subscription",
    stripePriceIdMonthly: "price_x",
    stripePriceIdAnnual: null,
  });
  fakeDb.doc("products/p2").set({ agencyId: "ag1", name: "Draft", status: "draft", isPublic: false });
  // Foreign agency — must be excluded from every count.
  fakeDb.doc("products/pX").set({ agencyId: "ag2", name: "Foreign", status: "active", isPublic: true });

  fakeDb.doc("marketplace_purchases/cs_1").set({
    agencyId: "ag1",
    paymentStatus: "paid",
    fulfilledAt: new Date("2026-07-01T00:00:00Z"),
  });
  fakeDb.doc("product_entitlements/u1_p1").set({ agencyId: "ag1", status: "active" });
  fakeDb.doc("partner_profiles/u1").set({ agencyId: "ag1", fullName: "P", status: "active" });
  fakeDb.doc("commission_events/ce1").set({ agencyId: "ag1", status: "pending" });
  fakeDb.doc("credit_wallets/u1").set({ agencyId: "ag1", partnerProfileId: "u1", balanceCredits: 10 });
  fakeDb.doc("partner_network_events/ev1").set({
    agencyId: "ag1",
    eventType: "partner.created",
    status: "pending",
    exportAttempts: 0,
  });
}

function get(key: string = KEY): Request {
  return new Request("http://test/api/agent/v1/control-plane/summary", {
    headers: { authorization: `Bearer ${key}` },
  });
}

describe("GET /api/agent/v1/control-plane/summary", () => {
  beforeEach(() => {
    resetFakeDb();
    seedData();
  });

  it("returns counts + readiness for the key's agency only", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.counts).toMatchObject({
      products: { total: 2, activePublic: 1 },
      purchases: { total: 1, paid: 1 },
      entitlements: { total: 1, active: 1 },
      partners: { total: 1, active: 1 },
      commissions: { pending: 1 },
      creditWallets: { total: 1 },
      partnerEvents: { pending: 1, failed: 0 },
    });
    expect(body.data.truncated).toBe(false);

    // Readiness checklist rides along with the summary shape.
    expect(body.data.readiness.summary.total).toBe(body.data.readiness.checklist.length);
    expect(body.data.readiness.env).toHaveProperty("isProd");

    // No secret values anywhere in the payload.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("sk_test");
    expect(raw).not.toContain("sk_live");
  });

  it("401s with a bad key", async () => {
    const res = await GET(get("ugl_" + "0".repeat(40)));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_KEY");
  });

  it("403s SCOPE_MISSING for a key without control_plane:read", async () => {
    const res = await GET(get(NO_SCOPE_KEY));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SCOPE_MISSING");
  });
});
