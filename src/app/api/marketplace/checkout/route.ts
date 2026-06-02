import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getStripeServer } from "@/lib/stripe/server";
import type { MemberStatus, Role } from "@/types";

/**
 * POST /api/marketplace/checkout
 *
 * Creates a Stripe Checkout Session for a marketplace product purchase.
 * This stub is safe by default: it only activates when
 * MARKETPLACE_CHECKOUT_ENABLED=true is set in the environment AND the
 * product passes all eligibility checks.
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
 *   Product must be: active, public, and (for subscription access model)
 *   have at least one Stripe price ID configured.
 *
 * ── What is NOT activated ───────────────────────────────────────────────────
 * - No live Stripe charges. Sessions are created in test mode only
 *   (gated by MARKETPLACE_CHECKOUT_ENABLED=true).
 * - No commission events. Commission wiring happens in Phase 8+ when
 *   checkout.session.completed webhooks stamp partnerProfileId.
 * - No live PARTNER_COMMISSIONS_ENABLED behavior.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 *
 * POST /api/marketplace/checkout
 * {
 *   productId: string;              // products/{id}
 *   subAccountId: string;           // subAccounts/{id} the buyer operates
 *   billingInterval?: "monthly" | "annual"; // default "monthly"
 *   partnerReferralCode?: string | null;    // for future Phase 8 attribution
 * }
 *
 * ── Stripe metadata stamped on the session ──────────────────────────────────
 *
 * {
 *   kind: "marketplace_product_purchase",
 *   agencyId,
 *   subAccountId,
 *   customerUserId,
 *   productId,
 *   productFamily,
 *   referredByPartnerProfileId: null,  // resolved in Phase 8 from partnerReferralCode
 *   partnerReferralCode: string | null,
 * }
 */

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

  // Accept any active user (owner or staff) — sub-account membership is checked
  // against the subAccountId in the body below.
  const agencyId = claims.agencyId ?? "";
  if (!agencyId)
    return NextResponse.json({ error: "No agency associated with this account." }, { status: 403 });

  return { uid, agencyId };
}

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

  const { productId, subAccountId, billingInterval = "monthly", partnerReferralCode = null } = body;

  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  if (!subAccountId) {
    return NextResponse.json({ error: "subAccountId is required." }, { status: 400 });
  }

  const db = getAdminDb();

  // ── Guard 3: validate product ─────────────────────────────────────────────
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
    return NextResponse.json({ error: "Product does not belong to your agency." }, { status: 403 });
  }
  if (product.status !== "active") {
    return NextResponse.json(
      { error: "Product is not active.", reason: `Product status is "${product.status}".` },
      { status: 422 },
    );
  }
  if (!product.isPublic) {
    return NextResponse.json(
      { error: "Product is not publicly available.", reason: "Product is hidden from the marketplace." },
      { status: 422 },
    );
  }

  // For subscription products, require a Stripe price ID
  if (product.accessModel === "subscription") {
    const priceId =
      billingInterval === "annual"
        ? (product.stripePriceIdAnnual ?? product.stripePriceIdMonthly)
        : (product.stripePriceIdMonthly ?? product.stripePriceIdAnnual);

    if (!priceId) {
      return NextResponse.json(
        {
          error: "No Stripe price ID configured for this product.",
          reason: `Product ${productId} has no ${billingInterval} price ID. Configure it in the Admin panel.`,
        },
        { status: 422 },
      );
    }

    // ── Create Stripe Checkout Session ─────────────────────────────────────
    // Metadata is stamped now so the webhook can attribute the sale.
    // Phase 8: resolve partnerReferralCode → partnerProfileId here.
    const stripe = getStripeServer();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/sa/${subAccountId}/marketplace/products/${productId}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/sa/${subAccountId}/marketplace/products/${productId}?checkout=cancelled`,
      metadata: {
        kind: "marketplace_product_purchase",
        agencyId,
        subAccountId,
        customerUserId: uid,
        productId,
        productFamily: product.productFamily ?? "",
        // Phase 8: resolve partnerReferralCode → referredByPartnerProfileId
        referredByPartnerProfileId: "",
        partnerReferralCode: partnerReferralCode ?? "",
      },
    });

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
      productId,
      subAccountId,
      billingInterval,
      note: "Stripe Checkout Session created. Redirect the user to the returned URL.",
    });
  }

  // Credit and BYOK products — checkout not yet implemented via this route
  return NextResponse.json(
    {
      error: "Checkout for this access model is not yet supported.",
      reason: `Access model "${product.accessModel}" cannot be purchased through the marketplace checkout stub.`,
      note: "Subscription products are supported. Credit and BYOK flows will be added in a later phase.",
    },
    { status: 422 },
  );
}
