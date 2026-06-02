import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getStripeServer } from "@/lib/stripe/server";
import type { MemberStatus, Role } from "@/types";
import type { PartnerTier } from "@/types/partner";

/**
 * POST /api/marketplace/checkout
 *
 * Creates a Stripe Checkout Session for a marketplace product purchase.
 * Gated by MARKETPLACE_CHECKOUT_ENABLED=true (off in production by default).
 *
 * ── Phase 8 additions ────────────────────────────────────────────────────────
 *
 * Referral resolution:
 *   If partnerReferralCode is supplied, this route resolves it to a
 *   partner_profiles doc in the same agency. The resolved partnerProfileId is
 *   stamped on the Stripe session metadata so the checkout.session.completed
 *   webhook can attribute the commission without any ambiguity.
 *
 * Commission pre-calculation:
 *   The applicable commission rule (product-specific > global) is resolved at
 *   checkout creation time and its commissionPct, commissionAmountCents, and
 *   commissionRuleId are stamped on the session metadata. Snapshotting at
 *   checkout creation time means rule changes after the session is created do
 *   not affect the commission paid for that sale.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   MARKETPLACE_CHECKOUT_ENABLED=true is explicitly set.
 *
 * Guard 2 — Auth gate:
 *   x-user-uid is injected by Next.js middleware from a verified Firebase
 *   session cookie. Verified against Firebase Admin Auth; user must be active.
 *
 * Guard 3 — Product validation:
 *   Product must be: active, public, and (for subscription) have at least one
 *   Stripe price ID configured.
 *
 * ── What is NOT activated ───────────────────────────────────────────────────
 * - No live commission events created here. The webhook handler
 *   (handleMarketplaceProductPurchase in webhooks.ts) fires on
 *   checkout.session.completed and calls createCommissionEventForPayment()
 *   only when PARTNER_COMMISSIONS_ENABLED=true.
 * - No PartnerReferral doc created here. That collection tracks partner-to-
 *   partner operator signups, not product sales.
 * - No MLM, downline, or genealogy logic.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 *
 * POST /api/marketplace/checkout
 * {
 *   productId: string;
 *   subAccountId: string;
 *   billingInterval?: "monthly" | "annual";  // default "monthly"
 *   partnerReferralCode?: string | null;      // from myusa_partner_ref cookie
 * }
 *
 * ── Stripe session metadata ──────────────────────────────────────────────────
 *
 * {
 *   kind: "marketplace_product_purchase",
 *   agencyId,
 *   subAccountId,
 *   customerUserId,
 *   productId,
 *   productFamily,
 *   referredByPartnerProfileId,   // "" when no valid referral code
 *   partnerReferralCode,          // "" when none
 *   commissionPercent,            // "0" when no rule found; snapshotted at session creation
 *   commissionRuleId,             // "" when no rule found
 *   commissionHoldDays,           // String(COMMISSION_HOLD_DAYS), default "30"
 *   // NOTE: commissionAmountCents is NOT stamped here — the webhook recalculates
 *   // it from session.amount_total × commissionPercent at payment time so the
 *   // payout always reflects the actual charged amount.
 * }
 */

// Default refund-window hold for marketplace product commissions (days).
// Prevents paying out commission before the customer's refund window closes.
const COMMISSION_HOLD_DAYS = Number(process.env.COMMISSION_HOLD_DAYS ?? "30");

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

function isCheckoutGated(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.MARKETPLACE_CHECKOUT_ENABLED !== "true"
  );
}

async function requireActiveUser(
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

  const agencyId = claims.agencyId ?? "";
  if (!agencyId)
    return NextResponse.json(
      { error: "No agency associated with this account." },
      { status: 403 },
    );

  return { uid, agencyId };
}

// ---------------------------------------------------------------------------
// Referral code resolution (Admin SDK)
// ---------------------------------------------------------------------------

/**
 * Looks up a partner_profiles doc by referralCode within the given agency.
 * Returns the partnerProfileId (=== uid) or null if not found / inactive.
 *
 * Only active/approved partners earn commission — a suspended or terminated
 * partner's code silently resolves to null so checkout still works but no
 * commission is attributed.
 */
async function resolveReferralCode(
  agencyId: string,
  referralCode: string,
): Promise<string | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("partner_profiles")
    .where("agencyId", "==", agencyId)
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get()
    .catch(() => null);

  if (!snap || snap.empty) return null;

  const data = snap.docs[0].data() as { status: string };
  const eligibleStatuses = ["active", "approved"];
  if (!eligibleStatuses.includes(data.status)) return null;

  return snap.docs[0].id; // doc id === uid === partnerProfileId
}

// ---------------------------------------------------------------------------
// Commission rule resolution (Admin SDK)
// ---------------------------------------------------------------------------

interface ResolvedCommission {
  commissionRuleId: string;
  commissionPercent: number;
  commissionAmountCents: number;
}

/**
 * Finds the best matching active commission rule for a product + partner tier,
 * then calculates the commission amount from the sale price.
 *
 * Preference order mirrors resolveCommissionRule() in product-card.tsx:
 *   1. Product-specific + tier-specific
 *   2. Product-specific + all tiers (partnerTier === null)
 *   3. Global (productId === null) + tier-specific
 *   4. Global + all tiers
 *
 * Returns null when no active rule covers the product.
 */
async function resolveCommission(
  agencyId: string,
  productId: string,
  partnerTier: PartnerTier | null,
  saleAmountCents: number,
): Promise<ResolvedCommission | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("commission_rules")
    .where("agencyId", "==", agencyId)
    .where("isActive", "==", true)
    .get()
    .catch(() => null);

  if (!snap || snap.empty) return null;

  const active = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as { productId: string | null; partnerTier: PartnerTier | null; commissionPct: number }),
  }));

  const candidates = [
    active.find((r) => r.productId === productId && r.partnerTier === partnerTier),
    active.find((r) => r.productId === productId && r.partnerTier === null),
    active.find((r) => r.productId === null && r.partnerTier === partnerTier),
    active.find((r) => r.productId === null && r.partnerTier === null),
  ];

  const rule = candidates.find(Boolean);
  if (!rule) return null;

  return {
    commissionRuleId: rule.id,
    commissionPercent: rule.commissionPct,
    commissionAmountCents: Math.floor((saleAmountCents * rule.commissionPct) / 100),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Guard 1 — environment gate
  if (isCheckoutGated()) {
    return NextResponse.json(
      {
        error: "Marketplace checkout is disabled in production.",
        note: "Set MARKETPLACE_CHECKOUT_ENABLED=true to enable test sessions.",
      },
      { status: 403 },
    );
  }

  // Guard 2 — auth
  const auth = await requireActiveUser(request);
  if (auth instanceof NextResponse) return auth;
  const { uid, agencyId } = auth;

  // Parse body
  let body: {
    productId?: string;
    subAccountId?: string;
    billingInterval?: "monthly" | "annual";
    partnerReferralCode?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const {
    productId,
    subAccountId,
    billingInterval = "monthly",
    partnerReferralCode = null,
  } = body;

  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  if (!subAccountId) {
    return NextResponse.json({ error: "subAccountId is required." }, { status: 400 });
  }

  const db = getAdminDb();

  // ── Validate product ──────────────────────────────────────────────────────
  const productSnap = await db.doc(`products/${productId}`).get().catch(() => null);
  if (!productSnap?.exists) {
    return NextResponse.json({ error: `Product ${productId} not found.` }, { status: 404 });
  }

  const product = productSnap.data() as {
    agencyId: string;
    name: string;
    status: string;
    isPublic: boolean;
    accessModel: string;
    productFamily: string | null;
    stripePriceIdMonthly: string | null;
    stripePriceIdAnnual: string | null;
  };

  if (product.agencyId !== agencyId) {
    return NextResponse.json(
      { error: "Product does not belong to your agency." },
      { status: 403 },
    );
  }
  if (product.status !== "active") {
    return NextResponse.json(
      { error: "Product is not active.", reason: `Product status is "${product.status}".` },
      { status: 422 },
    );
  }
  if (!product.isPublic) {
    return NextResponse.json(
      { error: "Product is not publicly available." },
      { status: 422 },
    );
  }

  // ── Subscription products only ────────────────────────────────────────────
  if (product.accessModel !== "subscription") {
    return NextResponse.json(
      {
        error: "Checkout for this access model is not yet supported.",
        reason: `Access model "${product.accessModel}" cannot be purchased through the marketplace checkout.`,
        note: "Subscription products are supported. Credit and BYOK flows will be added in a later phase.",
      },
      { status: 422 },
    );
  }

  const priceId =
    billingInterval === "annual"
      ? (product.stripePriceIdAnnual ?? product.stripePriceIdMonthly)
      : (product.stripePriceIdMonthly ?? product.stripePriceIdAnnual);

  if (!priceId) {
    return NextResponse.json(
      {
        error: "No Stripe price ID configured for this product.",
        reason: `Product ${productId} has no ${billingInterval} price ID.`,
      },
      { status: 422 },
    );
  }

  // ── Referral resolution ───────────────────────────────────────────────────
  // Resolve the referral code → partnerProfileId before creating the session.
  // A missing or invalid code is not an error — checkout proceeds without
  // attribution. A suspended/terminated partner's code also resolves to null.
  let referredByPartnerProfileId = "";
  let resolvedPartnerTier: PartnerTier | null = null;

  if (partnerReferralCode && partnerReferralCode.trim().length > 0) {
    const resolved = await resolveReferralCode(agencyId, partnerReferralCode.trim());
    if (resolved) {
      referredByPartnerProfileId = resolved;
      // Fetch the partner tier so commission resolution can be tier-specific.
      const partnerSnap = await db.doc(`partner_profiles/${resolved}`).get().catch(() => null);
      if (partnerSnap?.exists) {
        const pd = partnerSnap.data() as { tier?: PartnerTier };
        resolvedPartnerTier = pd.tier ?? null;
      }
    } else {
      console.info(
        `[checkout] Referral code "${partnerReferralCode}" not found or partner inactive — proceeding without attribution.`,
      );
    }
  }

  // ── Commission pre-calculation ────────────────────────────────────────────
  // Only calculate when a valid partner was resolved — no partner, no commission.
  // We use the Stripe price amount as a proxy for the sale amount.
  // The session amount_total won't be known until the webhook fires, so we
  // snapshot the rule now and recalculate from the actual amount_total in the
  // webhook handler using the stamped commissionPercent.
  let commissionAmountCents = 0;
  let commissionPercent = 0;
  let commissionRuleId = "";

  if (referredByPartnerProfileId) {
    // Use a sentinel sale amount for metadata purposes; the webhook recalculates
    // from session.amount_total (the actual charged amount).
    const sentinel = 0; // placeholder — see webhook handler
    const resolved = await resolveCommission(
      agencyId,
      productId,
      resolvedPartnerTier,
      sentinel,
    );
    if (resolved) {
      commissionPercent = resolved.commissionPercent;
      commissionRuleId = resolved.commissionRuleId;
      // commissionAmountCents will be recalculated in the webhook from
      // session.amount_total × commissionPercent / 100. We stamp only
      // commissionPercent + commissionRuleId here.
      commissionAmountCents = 0; // recalculated at webhook time
    } else {
      console.info(
        `[checkout] No active commission rule covers product ${productId} for partner ${referredByPartnerProfileId} — commission will be 0.`,
      );
    }
  }

  // ── Create Stripe Checkout Session ───────────────────────────────────────
  const stripe = getStripeServer();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/sa/${subAccountId}/marketplace/products/${productId}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/sa/${subAccountId}/marketplace/products/${productId}?checkout=cancelled`,
    metadata: {
      // ── Kind discriminator ────────────────────────────────────────────────
      kind: "marketplace_product_purchase",
      // ── Tenant / buyer ───────────────────────────────────────────────────
      agencyId,
      subAccountId,
      customerUserId: uid,
      // ── Product ──────────────────────────────────────────────────────────
      productId,
      productFamily: product.productFamily ?? "",
      // ── Attribution ──────────────────────────────────────────────────────
      // referredByPartnerProfileId: "" when no valid referral code was provided.
      referredByPartnerProfileId,
      partnerReferralCode: partnerReferralCode ?? "",
      // ── Commission snapshot ───────────────────────────────────────────────
      // commissionPercent is snapshotted at session creation so rule changes
      // after this moment don't affect the payout for this sale.
      // commissionAmountCents is recalculated in the webhook from
      // session.amount_total × commissionPercent / 100.
      commissionPercent: String(commissionPercent),
      commissionRuleId,
      // ── Hold window ───────────────────────────────────────────────────────
      commissionHoldDays: String(COMMISSION_HOLD_DAYS),
    },
  });

  console.info(
    `[checkout] Session ${session.id} created — product=${productId} partner=${referredByPartnerProfileId || "(none)"} rule=${commissionRuleId || "(none)"}`,
  );

  return NextResponse.json({
    url: session.url,
    sessionId: session.id,
    productId,
    subAccountId,
    billingInterval,
    attribution: {
      referredByPartnerProfileId: referredByPartnerProfileId || null,
      partnerReferralCode: partnerReferralCode || null,
      commissionPercent,
      commissionRuleId: commissionRuleId || null,
    },
    note: "Stripe Checkout Session created. Redirect the user to the returned URL.",
  });
}
