import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberStatus, Role } from "@/types";
import type { CheckoutStatus, PaymentStatus } from "@/types/marketplace";

/**
 * Dev-only: Create (or preview) a test marketplace_purchases doc.
 *
 * Designed for UI verification of Phase 9 pages without running a live Stripe
 * checkout. After one write:
 *   - /sa/[subAccountId]/marketplace/purchases  — shows the purchase
 *   - /sa/[subAccountId]/marketplace/partner    — shows it under Attributed Sales
 *     if referredByPartnerProfileId matches the logged-in partner profile
 *   - /agency/marketplace-purchases             — shows it in the admin list
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   REVENUE_OS_SEED_ALLOW_PRODUCTION=true is explicitly set.
 *
 * Guard 2 — Owner auth gate:
 *   x-user-uid is injected by Next.js middleware (next-firebase-auth-edge)
 *   from a verified Firebase session cookie. agencyRole must be "owner".
 *
 * Guard 3 — dryRun default:
 *   dryRun defaults to true. Pass { "dryRun": false } to write the doc.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 *
 * Doc id: `test_purchase_${uid}_${productId}`
 * Re-running with dryRun: false returns { skipped: true } — not a duplicate.
 * To create a second test purchase, supply a different productId in the body.
 *
 * ── Constraints ─────────────────────────────────────────────────────────────
 * - Does NOT activate live checkout.
 * - Does NOT create commission events (write the purchase doc only).
 * - Does NOT build MLM/genealogy/downline logic.
 * - Does NOT remove or override any env flags.
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *
 * POST /api/dev-only/create-test-marketplace-purchase
 *   Body (all optional):
 *   {
 *     dryRun?: boolean,                    // default true
 *     productId?: string,                  // default "prod_dfy_crm_setup"
 *     subAccountId?: string,               // default = caller's first membership
 *     amountTotalCents?: number,           // default 10000 ($100.00)
 *     paymentStatus?: "paid"|"unpaid",     // default "paid"
 *     checkoutStatus?: "complete"|"open"|"expired", // default "complete"
 *     referredByPartnerProfileId?: string, // default = caller uid (bootstrapped partner)
 *     partnerReferralCode?: string,        // default "TESTREF"
 *     commissionEventId?: string           // default null
 *   }
 *
 * ── Usage (browser DevTools console) ────────────────────────────────────────
 *
 *   // Dry-run — preview without writing:
 *   fetch('/api/dev-only/create-test-marketplace-purchase', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: true }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Live write with defaults (attributed to logged-in user's partner profile):
 *   fetch('/api/dev-only/create-test-marketplace-purchase', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: false }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Unattributed purchase (no partner):
 *   fetch('/api/dev-only/create-test-marketplace-purchase', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       dryRun: false,
 *       referredByPartnerProfileId: null,
 *       partnerReferralCode: null,
 *       productId: 'prod_ai_lead_followup',
 *     }),
 *   }).then(r => r.json()).then(console.log);
 */

const DEFAULT_PRODUCT_ID = "prod_dfy_crm_setup";
const DEFAULT_AMOUNT_CENTS = 10_000;   // $100.00
const DEFAULT_REFERRAL_CODE = "TESTREF";
const MARKETPLACE_PURCHASES = "marketplace_purchases";

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
    subAccountId?: string;
    amountTotalCents?: number;
    paymentStatus?: PaymentStatus;
    checkoutStatus?: CheckoutStatus;
    referredByPartnerProfileId?: string | null;
    partnerReferralCode?: string | null;
    commissionEventId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Guard 3 — dryRun defaults to true
  const dryRun = body.dryRun !== false;

  const productId = body.productId ?? DEFAULT_PRODUCT_ID;
  const amountTotalCents = body.amountTotalCents ?? DEFAULT_AMOUNT_CENTS;
  const paymentStatus: PaymentStatus = body.paymentStatus ?? "paid";
  const checkoutStatus: CheckoutStatus = body.checkoutStatus ?? "complete";
  const commissionEventId = body.commissionEventId ?? null;

  // Determine subAccountId: body > caller's first membership
  const db = getAdminDb();
  let subAccountId = body.subAccountId ?? null;
  if (!subAccountId) {
    const membershipSnap = await db
      .collection("userMemberships")
      .doc(uid)
      .collection("subAccounts")
      .limit(1)
      .get()
      .catch(() => null);
    subAccountId = membershipSnap?.docs[0]?.id ?? null;
  }

  if (!subAccountId) {
    return NextResponse.json(
      { error: "Could not resolve subAccountId. Pass it explicitly in the body." },
      { status: 400 },
    );
  }

  // Attribution: default to caller uid (bootstrapped partner profile) if
  // referredByPartnerProfileId is not explicitly passed (including null).
  const referredByPartnerProfileId =
    "referredByPartnerProfileId" in body
      ? (body.referredByPartnerProfileId ?? null)
      : uid;

  const partnerReferralCode =
    "partnerReferralCode" in body
      ? (body.partnerReferralCode ?? null)
      : referredByPartnerProfileId
        ? DEFAULT_REFERRAL_CODE
        : null;

  // Deterministic doc id — idempotent on re-runs
  const docId = `test_purchase_${uid}_${productId}`;
  const stripeSessionId = docId; // treat docId as the session id for test records

  // ── Fetch supporting data for preflight / snapshot ──────────────────────

  const [productSnap, partnerSnap] = await Promise.all([
    db.doc(`products/${productId}`).get().catch(() => null),
    referredByPartnerProfileId
      ? db.doc(`partner_profiles/${referredByPartnerProfileId}`).get().catch(() => null)
      : Promise.resolve(null),
  ]);

  const productExists = productSnap?.exists ?? false;
  const productData = productSnap?.data() as
    | { name?: string; status?: string; productFamily?: string; agencyId?: string }
    | undefined;

  const partnerExists = partnerSnap?.exists ?? false;
  const partnerData = partnerSnap?.data() as
    | { fullName?: string; status?: string; agencyId?: string }
    | undefined;

  const preflightWarnings: string[] = [];

  if (!productExists) {
    preflightWarnings.push(
      `products/${productId} not found — run the Revenue OS seeder first`,
    );
  } else if (productData?.agencyId !== agencyId) {
    preflightWarnings.push("Product agencyId mismatch");
  }

  if (referredByPartnerProfileId) {
    if (!partnerExists) {
      preflightWarnings.push(
        `partner_profiles/${referredByPartnerProfileId} not found — run /api/dev-only/bootstrap-partner first`,
      );
    } else if (partnerData?.agencyId !== agencyId) {
      preflightWarnings.push("Partner agencyId mismatch");
    } else if (
      partnerData?.status !== "active" &&
      partnerData?.status !== "approved"
    ) {
      preflightWarnings.push(
        `Partner status is "${partnerData?.status}" — not active/approved`,
      );
    }
  }

  const productName = productData?.name ?? productId;
  const productFamily = (productData?.productFamily ?? null) as string | null;

  // ── Dry-run ─────────────────────────────────────────────────────────────

  const purchasePayload = {
    agencyId,
    subAccountId,
    customerUserId: uid,
    productId,
    productName,
    productFamily,
    stripeSessionId,
    stripePaymentIntentId: null,
    amountTotalCents,
    currency: "usd",
    checkoutStatus,
    paymentStatus,
    referredByPartnerProfileId: referredByPartnerProfileId ?? null,
    partnerReferralCode: partnerReferralCode ?? null,
    commissionEventId,
    // createdAt / updatedAt are serverTimestamp() on real write
  };

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      docId,
      subAccountId,
      productInfo: {
        id: productId,
        name: productName,
        productFamily,
        exists: productExists,
      },
      partnerInfo: referredByPartnerProfileId
        ? {
            uid: referredByPartnerProfileId,
            fullName: partnerData?.fullName ?? "(not found)",
            status: partnerData?.status ?? "(not found)",
            exists: partnerExists,
          }
        : null,
      preflightWarnings,
      purchasePayload,
      note:
        preflightWarnings.length === 0
          ? "✅ All preflight checks passed. Set dryRun: false to write the doc."
          : `⚠️ ${preflightWarnings.length} preflight warning(s) — fix these before writing.`,
    });
  }

  // ── Live write ─────────────────────────────────────────────────────────

  const docRef = db.collection(MARKETPLACE_PURCHASES).doc(docId);

  // Check for existing doc — return skipped rather than overwrite
  const existing = await docRef.get().catch(() => null);
  if (existing?.exists) {
    return NextResponse.json({
      dryRun: false,
      status: "skipped",
      docId,
      reason: "Doc already exists (idempotent). To create another test purchase, use a different productId.",
      note: `View at /sa/${subAccountId}/marketplace/purchases`,
    });
  }

  await docRef.set({
    ...purchasePayload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    dryRun: false,
    status: "created",
    docId,
    subAccountId,
    productId,
    productName,
    amountTotalCents,
    paymentStatus,
    checkoutStatus,
    referredByPartnerProfileId: referredByPartnerProfileId ?? null,
    partnerReferralCode: partnerReferralCode ?? null,
    commissionEventId,
    preflightWarnings,
    note: [
      `Purchase doc written: marketplace_purchases/${docId}`,
      `View at /sa/${subAccountId}/marketplace/purchases`,
      referredByPartnerProfileId
        ? `Attributed to partner ${referredByPartnerProfileId} — visible at /sa/${subAccountId}/marketplace/partner`
        : "Unattributed purchase.",
      `Agency admin view: /agency/marketplace-purchases`,
    ].join("\n"),
  });
}
