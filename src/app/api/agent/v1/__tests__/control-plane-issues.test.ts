import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET } from "@/app/api/agent/v1/control-plane/issues/route";

let KEY: string;

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

  // critical: paid purchase without fulfillment
  fakeDb.doc("marketplace_purchases/cs_1").set({
    agencyId: "ag1",
    productName: "CRM Pro",
    paymentStatus: "paid",
    fulfilledAt: null,
  });
  // warning: active partner without referral code (also → missing wallet warning)
  fakeDb.doc("partner_profiles/u1").set({
    agencyId: "ag1",
    fullName: "Pat Doe",
    displayName: null,
    email: "pat@example.com",
    status: "active",
    referralCode: null,
    pendingCommissionCents: 0,
  });
  // Foreign agency criticals — must never appear.
  fakeDb.doc("marketplace_purchases/cs_X").set({
    agencyId: "ag2",
    productName: "Foreign",
    paymentStatus: "paid",
    fulfilledAt: null,
  });
}

function get(qs = "", key: string = KEY): Request {
  return new Request(`http://test/api/agent/v1/control-plane/issues${qs ? `?${qs}` : ""}`, {
    headers: { authorization: `Bearer ${key}` },
  });
}

describe("GET /api/agent/v1/control-plane/issues", () => {
  beforeEach(() => {
    resetFakeDb();
    seedData();
  });

  it("returns severity-sorted issues for the key's agency only, with the contract fields", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.length).toBe(3);
    expect(body.total).toBe(3);
    expect(body.truncated).toBe(false);
    expect(body.data[0]).toMatchObject({
      domain: "fulfillment",
      issue_code: "paid_purchase_unfulfilled",
      source_entity_type: "purchase",
      source_entity_id: "cs_1",
      severity: "critical",
      safe_action_url: "/agency/marketplace-purchases",
    });
    // Contract fields present on every row.
    for (const issue of body.data) {
      for (const field of [
        "domain",
        "issue_code",
        "source_entity_type",
        "source_entity_id",
        "display_name",
        "status",
        "severity",
        "summary",
        "safe_action_url",
      ]) {
        expect(issue).toHaveProperty(field);
      }
    }
    // Foreign-agency data never leaks; PII never leaks.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("cs_X");
    expect(raw).not.toContain("@example.com");
  });

  it("filters by domain", async () => {
    const res = await GET(get("domain=partners"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].domain).toBe("partners");
  });

  it("filters by severity", async () => {
    const res = await GET(get("severity=critical"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].severity).toBe("critical");
  });

  it("applies limit and reports truncation", async () => {
    const res = await GET(get("limit=1"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.truncated).toBe(true);
  });

  it("400s on invalid domain, severity, and limit", async () => {
    for (const qs of ["domain=nope", "severity=fatal", "limit=0", "limit=201", "limit=abc"]) {
      const res = await GET(get(qs));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("401s with a bad key and 403s without the scope", async () => {
    const res401 = await GET(get("", "ugl_" + "f".repeat(40)));
    expect(res401.status).toBe(401);

    const gen = generateServiceKey();
    fakeDb.doc("agencyServiceKeys/key2").set({
      agencyId: "ag1",
      label: "narrow",
      keyHash: gen.keyHash,
      keyPrefix: gen.keyPrefix,
      allowedSubAccounts: [],
      scopes: ["reports:read"],
      status: "active",
    });
    const res403 = await GET(get("", gen.key));
    expect(res403.status).toBe(403);
    expect((await res403.json()).error.code).toBe("SCOPE_MISSING");
  });
});
