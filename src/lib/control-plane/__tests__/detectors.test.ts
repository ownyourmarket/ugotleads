import { beforeEach, describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { runDetectors } from "@/lib/control-plane/detectors";
import { productsDetector } from "@/lib/control-plane/detectors/products";
import { fulfillmentDetector } from "@/lib/control-plane/detectors/fulfillment";
import { partnersDetector } from "@/lib/control-plane/detectors/partners";
import { commissionsDetector } from "@/lib/control-plane/detectors/commissions";
import { creditsDetector } from "@/lib/control-plane/detectors/credits";
import { byokDetector } from "@/lib/control-plane/detectors/byok";
import { partnerEventsDetector } from "@/lib/control-plane/detectors/partner-events";
import { toMillis, type DetectorContext } from "@/lib/control-plane/types";

const NOW = new Date("2026-07-12T00:00:00Z").getTime();

function ctx(overrides?: Partial<DetectorContext>): DetectorContext {
  return {
    db: fakeDb as unknown as Firestore,
    agencyId: "ag1",
    now: NOW,
    maxDocs: 2000,
    ...overrides,
  };
}

describe("control-plane detectors", () => {
  beforeEach(() => resetFakeDb());

  it("toMillis handles Timestamp-like, Date, number, seconds shapes, and garbage", () => {
    expect(toMillis({ toMillis: () => 42 })).toBe(42);
    expect(toMillis(new Date(1000))).toBe(1000);
    expect(toMillis(5000)).toBe(5000);
    expect(toMillis({ seconds: 2 })).toBe(2000);
    expect(toMillis({ _seconds: 3 })).toBe(3000);
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis("nope")).toBeNull();
  });

  it("products: flags active public subscription product missing price as critical", async () => {
    fakeDb.doc("products/p1").set({
      agencyId: "ag1",
      name: "CRM Pro",
      status: "active",
      isPublic: true,
      accessModel: "subscription",
      stripePriceIdMonthly: null,
      stripePriceIdAnnual: null,
    });
    // Healthy product: has a price.
    fakeDb.doc("products/p2").set({
      agencyId: "ag1",
      name: "OK Product",
      status: "active",
      isPublic: true,
      accessModel: "subscription",
      stripePriceIdMonthly: "price_x",
      stripePriceIdAnnual: null,
    });
    // Foreign agency — must be excluded.
    fakeDb.doc("products/pX").set({
      agencyId: "ag2",
      name: "Foreign",
      status: "active",
      isPublic: true,
      accessModel: "subscription",
      stripePriceIdMonthly: null,
      stripePriceIdAnnual: null,
    });

    const { issues } = await productsDetector.run(ctx());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue_code: "subscription_product_missing_price",
      source_entity_id: "p1",
      severity: "critical",
      safe_action_url: "/agency/products",
    });
  });

  it("products: non-public missing price is warning; draft+public flagged", async () => {
    fakeDb.doc("products/p1").set({
      agencyId: "ag1",
      name: "Hidden Sub",
      status: "active",
      isPublic: false,
      accessModel: "subscription",
      stripePriceIdMonthly: null,
      stripePriceIdAnnual: null,
    });
    fakeDb.doc("products/p2").set({
      agencyId: "ag1",
      name: "Draft Public",
      status: "draft",
      isPublic: true,
      accessModel: "credit",
    });

    const { issues } = await productsDetector.run(ctx());
    const codes = issues.map((i) => `${i.issue_code}:${i.severity}`).sort();
    expect(codes).toEqual([
      "draft_product_public:warning",
      "subscription_product_missing_price:warning",
    ]);
  });

  it("fulfillment: flags paid purchase without fulfilledAt, ignores fulfilled and unpaid", async () => {
    fakeDb.doc("marketplace_purchases/cs_1").set({
      agencyId: "ag1",
      productName: "CRM Pro",
      paymentStatus: "paid",
      fulfilledAt: null,
    });
    fakeDb.doc("marketplace_purchases/cs_2").set({
      agencyId: "ag1",
      productName: "CRM Pro",
      paymentStatus: "paid",
      fulfilledAt: new Date("2026-07-01T00:00:00Z"),
      entitlementId: "e1",
    });
    fakeDb.doc("marketplace_purchases/cs_3").set({
      agencyId: "ag1",
      productName: "CRM Pro",
      paymentStatus: "unpaid",
      fulfilledAt: null,
    });

    const { issues } = await fulfillmentDetector.run(ctx());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue_code: "paid_purchase_unfulfilled",
      source_entity_id: "cs_1",
      severity: "critical",
    });
  });

  it("partners: flags missing referral code and suspended-with-pending, uses safe display name", async () => {
    fakeDb.doc("partner_profiles/u1").set({
      agencyId: "ag1",
      fullName: "Pat Doe",
      displayName: null,
      email: "pat@example.com",
      status: "active",
      referralCode: null,
      pendingCommissionCents: 0,
    });
    fakeDb.doc("partner_profiles/u2").set({
      agencyId: "ag1",
      fullName: "Sam Roe",
      displayName: "Sam R.",
      email: "sam@example.com",
      status: "suspended",
      referralCode: "SAM1",
      pendingCommissionCents: 5000,
    });
    fakeDb.doc("partner_profiles/u3").set({
      agencyId: "ag1",
      fullName: "Healthy Partner",
      displayName: null,
      email: "h@example.com",
      status: "active",
      referralCode: "HP1",
      pendingCommissionCents: 0,
    });

    const { issues } = await partnersDetector.run(ctx());
    expect(issues).toHaveLength(2);
    const byCode = Object.fromEntries(issues.map((i) => [i.issue_code, i]));
    expect(byCode.partner_missing_referral_code.display_name).toBe("Pat Doe");
    expect(byCode.suspended_partner_pending_commissions.display_name).toBe("Sam R.");
    // PII rule: no emails anywhere in the serialized issues.
    expect(JSON.stringify(issues)).not.toContain("@example.com");
  });

  it("commissions: flags pending past hold and commission on unpaid purchase", async () => {
    fakeDb.doc("commission_events/ce1").set({
      agencyId: "ag1",
      status: "pending",
      commissionCents: 1000,
      partnerProfileId: "u1",
      holdUntil: new Date(NOW - 1000),
    });
    fakeDb.doc("commission_events/ce2").set({
      agencyId: "ag1",
      status: "pending",
      commissionCents: 1000,
      partnerProfileId: "u1",
      holdUntil: new Date(NOW + 86_400_000),
    });
    fakeDb.doc("commission_events/ce3").set({
      agencyId: "ag1",
      status: "pending",
      commissionCents: 1000,
      partnerProfileId: "u1",
      holdUntil: null,
    });
    fakeDb.doc("marketplace_purchases/cs_9").set({
      agencyId: "ag1",
      productName: "Refunded Thing",
      paymentStatus: "unpaid",
      commissionEventId: "ce1",
    });

    const { issues } = await commissionsDetector.run(ctx());
    const codes = issues.map((i) => i.issue_code).sort();
    expect(codes).toEqual(["commission_on_unpaid_purchase", "commission_past_hold"]);
    const pastHold = issues.find((i) => i.issue_code === "commission_past_hold");
    expect(pastHold?.source_entity_id).toBe("ce1");
  });

  it("credits: flags negative balance and active partner without wallet via id invariant", async () => {
    fakeDb.doc("credit_wallets/u1").set({
      agencyId: "ag1",
      partnerProfileId: "u1",
      balanceCredits: -5,
    });
    fakeDb.doc("partner_profiles/u1").set({
      agencyId: "ag1",
      fullName: "Has Wallet",
      status: "active",
    });
    fakeDb.doc("partner_profiles/u2").set({
      agencyId: "ag1",
      fullName: "No Wallet",
      status: "active",
    });
    fakeDb.doc("partner_profiles/u3").set({
      agencyId: "ag1",
      fullName: "Applied Only",
      status: "applied",
    });

    const { issues } = await creditsDetector.run(ctx());
    const codes = issues.map((i) => `${i.issue_code}:${i.source_entity_id}`).sort();
    expect(codes).toEqual([
      "active_partner_missing_wallet:u2",
      "wallet_negative_balance:u1",
    ]);
  });

  it("byok: flags approved byok eligibility without key; never reads byok_keys", async () => {
    fakeDb.doc("product_eligibility/u1_p1").set({
      agencyId: "ag1",
      partnerProfileId: "u1",
      productId: "p1",
      status: "approved",
      accessModel: "byok",
      byokConfigured: false,
    });
    fakeDb.doc("product_eligibility/u2_p1").set({
      agencyId: "ag1",
      partnerProfileId: "u2",
      productId: "p1",
      status: "approved",
      accessModel: "byok",
      byokConfigured: true,
    });
    // A byok_keys doc with secret material — must never surface anywhere.
    fakeDb.doc("byok_keys/u1_p1").set({
      agencyId: "ag1",
      encryptedKey: "SECRET_MATERIAL",
      iv: "IV_BYTES",
      authTag: "TAG_BYTES",
      keyLast4: "abcd",
    });

    const { issues } = await byokDetector.run(ctx());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue_code: "byok_not_configured",
      source_entity_id: "u1_p1",
    });
    expect(JSON.stringify(issues)).not.toContain("SECRET_MATERIAL");
  });

  it("partner-events: flags failed and stuck-pending events", async () => {
    fakeDb.doc("partner_network_events/ev1").set({
      agencyId: "ag1",
      eventType: "marketplace.purchase.paid",
      status: "failed",
      exportAttempts: 3,
      errorMessage: "boom",
    });
    fakeDb.doc("partner_network_events/ev2").set({
      agencyId: "ag1",
      eventType: "partner.created",
      status: "pending",
      exportAttempts: 0,
      createdAt: new Date(NOW - 8 * 24 * 60 * 60 * 1000), // 8 days old
    });
    fakeDb.doc("partner_network_events/ev3").set({
      agencyId: "ag1",
      eventType: "partner.certified",
      status: "pending",
      exportAttempts: 0,
      createdAt: new Date(NOW - 60_000), // fresh — fine
    });

    const { issues } = await partnerEventsDetector.run(ctx());
    const codes = issues.map((i) => `${i.issue_code}:${i.source_entity_id}`).sort();
    expect(codes).toEqual([
      "partner_event_failed:ev1",
      "partner_event_stuck_pending:ev2",
    ]);
  });

  it("runDetectors: aggregates all domains, sorts severity-first, filters by domain", async () => {
    fakeDb.doc("marketplace_purchases/cs_1").set({
      agencyId: "ag1",
      productName: "X",
      paymentStatus: "paid",
      fulfilledAt: null,
    });
    fakeDb.doc("partner_profiles/u1").set({
      agencyId: "ag1",
      fullName: "P",
      status: "active",
      referralCode: null,
      pendingCommissionCents: 0,
    });
    // partner u1 also has no wallet → credits warning

    const all = await runDetectors(ctx());
    expect(all.issues.length).toBe(3);
    expect(all.issues[0].severity).toBe("critical"); // fulfillment first
    expect(all.truncated).toBe(false);

    const onlyPartners = await runDetectors(ctx(), "partners");
    expect(onlyPartners.issues).toHaveLength(1);
    expect(onlyPartners.issues[0].domain).toBe("partners");
  });

  it("reports truncation when a query hits maxDocs", async () => {
    fakeDb.doc("products/p1").set({ agencyId: "ag1", name: "A", status: "archived" });
    fakeDb.doc("products/p2").set({ agencyId: "ag1", name: "B", status: "archived" });
    const { truncated } = await productsDetector.run(ctx({ maxDocs: 2 }));
    expect(truncated).toBe(true);
  });
});
