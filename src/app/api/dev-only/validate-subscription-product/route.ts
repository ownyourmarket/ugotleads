import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { checkSubscriptionReadiness } from "@/lib/products/subscription-readiness";
import type { Product } from "@/types/products";
import type { MemberStatus, Role } from "@/types";

/**
 * Dev-only: Validate a subscription product's readiness for test checkout.
 *
 * Runs all checks from checkSubscriptionReadiness() against a real product doc.
 * Never creates a Stripe session. Never charges anything. Never touches Stripe.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   REVENUE_OS_SEED_ALLOW_PRODUCTION=true is explicitly set.
 *
 * Guard 2 — Owner auth gate:
 *   agencyRole must be "owner".
 *
 * Guard 3 — dryRun default: always true. This route is read-only; there is
 *   no live write path. dryRun is documented for consistency with other
 *   dev-only routes but has no behavioral effect here.
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *
 * POST /api/dev-only/validate-subscription-product
 *   Body (all optional):
 *   {
 *     productId?: string,  // specific product to validate
 *     dryRun?: boolean,    // default true (always read-only anyway)
 *   }
 *
 *   If productId is omitted, the first subscription product in the agency
 *   is used.
 *
 * ── Usage (browser DevTools console) ────────────────────────────────────────
 *
 *   // Validate a specific product:
 *   fetch('/api/dev-only/validate-subscription-product', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ productId: 'prod_dfy_crm_setup' }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Validate the first subscription product in the agency:
 *   fetch('/api/dev-only/validate-subscription-product', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({}),
 *   }).then(r => r.json()).then(console.log);
 */

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
  const { agencyId } = auth;

  // Parse body
  let body: { productId?: string; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedProductId = body.productId?.trim() ?? null;
  const db = getAdminDb();

  // ── Resolve product ───────────────────────────────────────────────────────
  let product: Product | null = null;
  let resolvedProductId: string | null = null;

  if (requestedProductId) {
    const snap = await db.doc(`products/${requestedProductId}`).get().catch(() => null);
    if (!snap?.exists) {
      return NextResponse.json(
        { error: `Product "${requestedProductId}" not found.` },
        { status: 404 },
      );
    }
    const data = snap.data() as Omit<Product, "id">;
    if (data.agencyId !== agencyId) {
      return NextResponse.json(
        { error: "Product does not belong to your agency." },
        { status: 403 },
      );
    }
    product = { id: snap.id, ...data };
    resolvedProductId = snap.id;
  } else {
    // Fall back to first subscription product in the agency
    const snap = await db
      .collection("products")
      .where("agencyId", "==", agencyId)
      .where("accessModel", "==", "subscription")
      .limit(1)
      .get()
      .catch(() => null);

    if (!snap || snap.empty) {
      return NextResponse.json(
        {
          error: "No subscription products found in this agency.",
          note: "Create a product with accessModel='subscription' first, or pass productId explicitly.",
        },
        { status: 404 },
      );
    }

    const doc = snap.docs[0];
    product = { id: doc.id, ...(doc.data() as Omit<Product, "id">) };
    resolvedProductId = doc.id;
  }

  // ── Run readiness check ───────────────────────────────────────────────────
  const result = checkSubscriptionReadiness(product, {
    checkoutEnvEnabled: process.env.MARKETPLACE_CHECKOUT_ENABLED === "true",
  });

  // ── Compile final report ──────────────────────────────────────────────────
  return NextResponse.json({
    dryRun: true,       // this route is always read-only
    productId: resolvedProductId,
    productName: product.name,
    requestedBy: body.productId ? "explicit" : "first-match",
    readiness: result,
    envFlags: {
      MARKETPLACE_CHECKOUT_ENABLED: process.env.MARKETPLACE_CHECKOUT_ENABLED ?? "(not set)",
      PARTNER_COMMISSIONS_ENABLED: process.env.PARTNER_COMMISSIONS_ENABLED ?? "(not set)",
      note:
        "These flags must be set for test checkout and commission creation respectively. " +
        "Do NOT set MARKETPLACE_CHECKOUT_ENABLED=true in production without completing " +
        "the Phase 18 activation checklist.",
    },
    activationChecklist: {
      "1_product_ready": result.overallReady,
      "2_stripe_price_ids_set": result.metadata.hasMonthlyPrice || result.metadata.hasAnnualPrice,
      "3_product_family_set": !!result.metadata.productFamily,
      "4_commissionable_explicit": result.metadata.isCommissionableExplicit,
      "5_eligibility_requirement_set": result.metadata.isEligibilityRequirementExplicit,
      "6_checkout_env_enabled": result.checkoutEnvEnabled,
      "allPassed": result.overallReady &&
        (result.metadata.hasMonthlyPrice || result.metadata.hasAnnualPrice) &&
        !!result.metadata.productFamily &&
        result.metadata.isCommissionableExplicit &&
        result.metadata.isEligibilityRequirementExplicit &&
        result.checkoutEnvEnabled,
    },
  });
}
