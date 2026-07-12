import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { computeReadiness } from "@/lib/readiness/compute";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return {
    getAdminDb: () => fakeDb,
    getAdminAuth: () => ({
      getUser: async (uid: string) =>
        uid === "owner1"
          ? {
              customClaims: {
                status: "active",
                agencyRole: "owner",
                agencyId: "ag1",
              },
            }
          : Promise.reject(new Error("no user")),
    }),
  };
});

import { GET as readinessGET } from "@/app/api/agency/readiness/route";

const db = () => fakeDb as unknown as Firestore;

const CHECKLIST_KEYS = [
  "firestore_rules",
  "firestore_indexes",
  "stripe_keys",
  "webhook_secret",
  "checkout_flag",
  "commissions_flag",
  "byok_secret",
  "crm_pro",
  "missing_prices",
  "active_public",
  "paid_unfulfilled",
  "pending_commissions",
];

describe("computeReadiness", () => {
  beforeEach(() => {
    resetFakeDb();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns the full checklist with stable keys and summary math", async () => {
    const result = await computeReadiness(db(), "ag1");
    expect(result.checklist.map((c) => c.key)).toEqual(CHECKLIST_KEYS);
    expect(result.summary.total).toBe(CHECKLIST_KEYS.length);
    expect(result.summary.blockers).toBe(
      result.checklist.filter((c) => c.severity === "blocked").length,
    );
    expect(result.summary.warnings).toBe(
      result.checklist.filter((c) => c.severity === "warn").length,
    );
  });

  it("flags CRM Pro active+public without prices as blocked", async () => {
    fakeDb.doc("products/p1").set({
      agencyId: "ag1",
      name: "CRM Pro",
      status: "active",
      isPublic: true,
      accessModel: "subscription",
      stripePriceIdMonthly: null,
      stripePriceIdAnnual: null,
    });
    const result = await computeReadiness(db(), "ag1");
    const crmPro = result.checklist.find((c) => c.key === "crm_pro");
    expect(crmPro?.severity).toBe("blocked");
    expect(result.summary.blockers).toBeGreaterThanOrEqual(1);
  });

  it("counts paid purchases missing fulfillment and pending commissions", async () => {
    fakeDb.doc("marketplace_purchases/cs_1").set({
      agencyId: "ag1",
      paymentStatus: "paid",
      fulfilledAt: null,
    });
    fakeDb.doc("commission_events/ce1").set({ agencyId: "ag1", status: "pending" });
    fakeDb.doc("commission_events/ce2").set({ agencyId: "ag1", status: "paid" });

    const result = await computeReadiness(db(), "ag1");
    expect(result.checklist.find((c) => c.key === "paid_unfulfilled")?.severity).toBe("warn");
    expect(result.checklist.find((c) => c.key === "pending_commissions")?.detail).toContain("1 commission");
  });

  it("reports Stripe test-mode key as ok and missing key as warn", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    let result = await computeReadiness(db(), "ag1");
    expect(result.checklist.find((c) => c.key === "stripe_keys")?.severity).toBe("ok");

    vi.stubEnv("STRIPE_SECRET_KEY", "");
    result = await computeReadiness(db(), "ag1");
    expect(result.checklist.find((c) => c.key === "stripe_keys")?.severity).toBe("warn");
  });
});

describe("GET /api/agency/readiness (session route regression)", () => {
  beforeEach(() => {
    resetFakeDb();
    vi.unstubAllEnvs();
  });

  it("keeps the pre-refactor response shape: { ok, env, summary, checklist }", async () => {
    const res = await readinessGET(
      new Request("http://test/api/agency/readiness", {
        headers: { "x-user-uid": "owner1" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["checklist", "env", "ok", "summary"]);
    expect(body.ok).toBe(true);
    expect(body.env).toHaveProperty("isProd");
    expect(body.summary).toMatchObject({ total: CHECKLIST_KEYS.length });
    expect(body.checklist.map((c: { key: string }) => c.key)).toEqual(CHECKLIST_KEYS);
  });

  it("401s without x-user-uid", async () => {
    const res = await readinessGET(new Request("http://test/api/agency/readiness"));
    expect(res.status).toBe(401);
  });
});
