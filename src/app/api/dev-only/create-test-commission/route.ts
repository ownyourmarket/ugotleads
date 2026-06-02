import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { createCommissionEventForPayment } from "@/lib/commissions/create-event";
import type { MemberStatus, Role } from "@/types";

/**
 * Dev-only: Create a test commission event for the logged-in agency owner.
 *
 * Uses seeded products and the bootstrapped partner profile by default.
 * Designed to test the full createCommissionEventForPayment() validation
 * path without activating live Stripe commission creation.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   REVENUE_OS_SEED_ALLOW_PRODUCTION=true is explicitly set.
 *
 * Guard 2 — Owner auth gate:
 *   x-user-uid is injected by Next.js middleware (next-firebase-auth-edge)
 *   from a verified Firebase session cookie — NOT a raw client header.
 *   Verified against Firebase Admin Auth; agencyRole must be "owner".
 *
 * Guard 3 — dryRun default:
 *   dryRun defaults to true. Pass { "dryRun": false } to perform real writes.
 *   Even with dryRun: false, PARTNER_COMMISSIONS_ENABLED must be "true" or
 *   createCommissionEventForPayment() will return { skipped }.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 *
 * Live writes use a deterministic paymentEventId:
 *   `test_commission_${uid}_${productId}`
 * Re-running with dryRun: false will return { skipped } instead of duplicate.
 * To create a second test event, supply a different productId in the body.
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *
 * POST /api/dev-only/create-test-commission
 *   Body (all fields optional):
 *   {
 *     dryRun?: boolean,           // default true
 *     productId?: string,         // default "prod_dfy_crm_setup"
 *     partnerProfileId?: string,  // default = caller's uid (bootstrapped partner)
 *     saleAmountCents?: number,   // default 10000
 *     commissionAmountCents?: number, // default 2000
 *     commissionPercent?: number, // default 20
 *     holdDays?: number           // default 14 — sets holdUntil N days from now
 *   }
 *
 * ── Usage (browser DevTools console) ────────────────────────────────────────
 *
 *   // Dry-run — preview the payload without writing:
 *   fetch('/api/dev-only/create-test-commission', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: true }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Live write — requires PARTNER_COMMISSIONS_ENABLED=true:
 *   fetch('/api/dev-only/create-test-commission', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: false }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Live write with a specific product and no hold window:
 *   fetch('/api/dev-only/create-test-commission', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: false, productId: 'prod_ai_lead_followup', holdDays: 0 }),
 *   }).then(r => r.json()).then(console.log);
 */

// Default test values — match seeded product + commission rule IDs from revenue-os-seeder.ts
const DEFAULT_PRODUCT_ID = "prod_dfy_crm_setup";
const DEFAULT_SALE_AMOUNT_CENTS = 10_000;         // $100.00
const DEFAULT_COMMISSION_AMOUNT_CENTS = 2_000;    // $20.00
const DEFAULT_COMMISSION_PERCENT = 20;
const DEFAULT_HOLD_DAYS = 14;
const DEFAULT_RULE_ID = "rule_product_sale_20pct"; // seeded in revenue-os-seeder.ts

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

function isProductionLocked(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.REVENUE_OS_SEED_ALLOW_PRODUCTION !== "true"
  );
}

async function requireOwner(
  request: Request,
): Promise<{ uid: string; agencyId: string } | NextResponse> {
  const uid = request.headers.get("x-user-uid");
  if (!uid)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json(
      { error: "Agency owner access required." },
      { status: 403 },
    );

  return { uid, agencyId: claims.agencyId };
}

export async function POST(request: Request) {
  // Guard 1 — production lock
  if (isProductionLocked()) {
    return NextResponse.json(
      {
        error:
          "This route is disabled in production. Set REVENUE_OS_SEED_ALLOW_PRODUCTION=true to override.",
      },
      { status: 403 },
    );
  }

  // Guard 2 — owner auth
  const auth = await requireOwner(request);
  if (auth instanceof NextResponse) return auth;
  const { uid, agencyId } = auth;

  // Parse body
  let body: {
    dryRun?: boolean;
    productId?: string;
    partnerProfileId?: string;
    saleAmountCents?: number;
    commissionAmountCents?: number;
    commissionPercent?: number;
    holdDays?: number;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Guard 3 — dryRun defaults to true
  const dryRun = body.dryRun !== false;

  const productId = body.productId ?? DEFAULT_PRODUCT_ID;
  const partnerProfileId = body.partnerProfileId ?? uid;
  const saleAmountCents = body.saleAmountCents ?? DEFAULT_SALE_AMOUNT_CENTS;
  const commissionAmountCents = body.commissionAmountCents ?? DEFAULT_COMMISSION_AMOUNT_CENTS;
  const commissionPercent = body.commissionPercent ?? DEFAULT_COMMISSION_PERCENT;
  const holdDays = body.holdDays !== undefined ? body.holdDays : DEFAULT_HOLD_DAYS;

  const holdUntil = holdDays > 0
    ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000)
    : null;

  // Deterministic paymentEventId for idempotency on re-runs
  const paymentEventId = `test_commission_${uid}_${productId}`;

  // ── Dry-run: build and return the payload without writing ─────────────
  if (dryRun) {
    const db = getAdminDb();

    // Fetch partner display info for the preview
    const partnerSnap = await db
      .doc(`partner_profiles/${partnerProfileId}`)
      .get()
      .catch(() => null);
    const partnerExists = partnerSnap?.exists ?? false;
    const partnerData = partnerSnap?.data() as
      | { fullName?: string; status?: string; agencyId?: string }
      | undefined;

    // Fetch product info for the preview
    const productSnap = await db
      .doc(`products/${productId}`)
      .get()
      .catch(() => null);
    const productExists = productSnap?.exists ?? false;
    const productData = productSnap?.data() as
      | { name?: string; status?: string }
      | undefined;

    // Fetch eligibility for the preview
    const eligibilityId = `${partnerProfileId}_${productId}`;
    const eligibilitySnap = await db
      .doc(`product_eligibility/${eligibilityId}`)
      .get()
      .catch(() => null);
    const eligibilityStatus =
      (eligibilitySnap?.data() as { status?: string } | undefined)?.status ?? null;

    // Fetch rule for the preview
    const ruleSnap = await db
      .doc(`commission_rules/${DEFAULT_RULE_ID}`)
      .get()
      .catch(() => null);
    const ruleExists = ruleSnap?.exists ?? false;

    const preflightWarnings: string[] = [];
    if (!partnerExists) preflightWarnings.push(`partner_profiles/${partnerProfileId} not found — run /api/dev-only/bootstrap-partner first`);
    if (partnerExists && partnerData?.agencyId !== agencyId) preflightWarnings.push("Partner agencyId mismatch");
    if (partnerExists && partnerData?.status !== "active" && partnerData?.status !== "approved") preflightWarnings.push(`Partner status is "${partnerData?.status}" — not active/approved`);
    if (!productExists) preflightWarnings.push(`products/${productId} not found — run the Revenue OS seeder first`);
    if (!ruleExists) preflightWarnings.push(`commission_rules/${DEFAULT_RULE_ID} not found — run the Revenue OS seeder first`);
    if (!eligibilitySnap?.exists) preflightWarnings.push(`product_eligibility/${eligibilityId} not found — run /api/dev-only/bootstrap-partner first`);
    if (eligibilitySnap?.exists && eligibilityStatus !== "approved") preflightWarnings.push(`Product eligibility status is "${eligibilityStatus}" — must be "approved"`);

    const commissionEventPayload = {
      agencyId,
      partnerProfileId,
      commissionRuleId: DEFAULT_RULE_ID,
      trigger: "product_sale",
      grossAmountCents: saleAmountCents,
      commissionCents: commissionAmountCents,
      commissionPct: commissionPercent,
      status: "pending",
      partnerReferralId: null,
      stripeEventId: null,
      holdUntil: holdUntil?.toISOString() ?? null,
      paidOutAt: null,
      paidOutNote: null,
      voidedAt: null,
      voidReason: null,
      // createdAt / updatedAt would be serverTimestamp() on real write
    };

    return NextResponse.json({
      dryRun: true,
      idempotencyKey: paymentEventId,
      holdUntil: holdUntil?.toISOString() ?? null,
      holdDays,
      partnerInfo: {
        uid: partnerProfileId,
        fullName: partnerData?.fullName ?? "(not found)",
        status: partnerData?.status ?? "(not found)",
        exists: partnerExists,
      },
      productInfo: {
        id: productId,
        name: productData?.name ?? "(not found)",
        status: productData?.status ?? "(not found)",
        exists: productExists,
      },
      eligibilityInfo: {
        docId: eligibilityId,
        status: eligibilityStatus,
        exists: eligibilitySnap?.exists ?? false,
      },
      ruleInfo: {
        id: DEFAULT_RULE_ID,
        exists: ruleExists,
      },
      preflightWarnings,
      commissionEventPayload,
      note:
        preflightWarnings.length === 0
          ? "✅ All preflight checks passed. Set dryRun: false (and PARTNER_COMMISSIONS_ENABLED=true) to create the event."
          : `⚠️ ${preflightWarnings.length} preflight warning(s) — fix these before running dryRun: false.`,
    });
  }

  // ── Live write ───────────────────────────────────────────────────────────
  const result = await createCommissionEventForPayment({
    agencyId,
    partnerProfileId,
    customerUserId: uid,
    customerSubAccountId: null,
    productId,
    stripeEventId: null,
    paymentEventId,
    saleAmountCents,
    commissionAmountCents,
    commissionPercent,
    commissionRuleId: DEFAULT_RULE_ID,
    holdUntil,
    metadata: {
      source: "dev_test_harness",
      callerUid: uid,
    },
  });

  if ("ok" in result) {
    return NextResponse.json({
      dryRun: false,
      status: "created",
      eventId: result.eventId,
      holdUntil: holdUntil?.toISOString() ?? null,
      holdDays,
      productId,
      partnerProfileId,
      commissionAmountCents,
      note: `Commission event created. View it at /agency/commissions. Doc id: ${result.eventId}`,
    });
  }

  if ("skipped" in result) {
    return NextResponse.json({
      dryRun: false,
      status: "skipped",
      reason: result.reason,
      idempotencyKey: paymentEventId,
      note:
        result.reason.includes("PARTNER_COMMISSIONS_ENABLED")
          ? "Set PARTNER_COMMISSIONS_ENABLED=true in your .env.local and restart the dev server."
          : `Skipped: ${result.reason}. To create a new event, change productId or run a wipe first.`,
    });
  }

  // error
  return NextResponse.json(
    { dryRun: false, status: "error", message: result.message },
    { status: 500 },
  );
}
